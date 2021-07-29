import Post from '../../models/post';
import mongoose from 'mongoose';
import Joi from 'joi';
import sanitizeHtml from 'sanitize-html';

const {ObjectId} = mongoose.Types;

// 텍스트 편집기를 사용해서 글 작성 시 태그가 글자 그대로 나오는 걸
// 방지하는 옵션.
const sanitizeOption = {
    allowedTags: [
        'h1',
        'h2',
        'b',
        'i',
        'u',
        's',
        'p',
        'ul',
        'ol',
        'li',
        'blockquote',
        'a',
        'img',
    ],
    allowedAttributes: {
        a: ['href', 'name', 'target'],
        img: ['src'],
        li: ['class'],
    },
    allowedSchemes: ['data', 'http'],
};

// 포스트 수정 및 삭제 시 권환 확인
export const getPostId = async (ctx, next) => {
    const {id} = ctx.params;
    if(!ObjectId.isValid(id)){
        ctx.status = 400;
        return;
    }
    try{
        const post = await Post.findById(id);
        // 포스트가 존재하지 않을 때
        if(!post){
            ctx.status = 404; //Not Found
            return;
        }
        ctx.state.post = post;
        return next();
    }catch(e){
        ctx.throw(500, e);
    }
};

// id로 찾은 포스트가 로그인 중인 사용자가 작성한 포스트인지 확인
export const checkOwnPost = (ctx, next) => {
    const {user, post} = ctx.state;
    if (post.user._id.toString() !== user._id){
        ctx.status = 403;
        return;
    }
    return next();
};

// POST /api/posts
// Joi : Request Body 검증을 쉽게 해주는 라이브러리
// Request Body 검증 : API에서 전달 받은 요청 내용을 검증. (포스트 작성 시 title, body, tags 값을 모두 전달받아야 함.)
export const write = async (ctx) => {
    const schema = Joi.object().keys({
        title: Joi.string().required(),
        body: Joi.string().required(),
        tags: Joi.array()
            .items(Joi.string())
            .required(),
    });

    const result = schema.validate(ctx.request.body);
    if(result.error){
        ctx.status = 400;
        ctx.body = result.error;
        return;
    }

    const {title, body, tags} = ctx.request.body;
    const post = new Post({
        title,
        body: sanitizeHtml(body,sanitizeOption),
        tags,
        user: ctx.state.user,
    });
    try{
        await post.save();
        ctx.body = post;
    } catch(e){
        ctx.throw(500, e)
    }
};

// GET /api/posts
// 포스트 리스트 글이 200자 이상이면 '...'으로 자름
const removeHtmlAndShorten = body => {
    const filtered = sanitizeHtml(body, {
        allowedTags: [],
    });
    return filtered.length < 200 ? filtered : `${filtered.slice(0, 200)}...`;
};

// 포스트 리스트
export const list = async ctx => {
    const page = parseInt(ctx.query.page || '1', 10);

    if(page < 1){
        ctx.status = 400;
        return;
    }

    const {tag, username} = ctx.query;
    const query = {
        ...(username ? {'user.username': username} : {}),
        ...(tag ? {tag : tag} : {}),
    };

    try{
        const posts = await Post.find()
            .sort({_id: -1})
            .limit(10)
            .skip((page - 1) * 10)
            .lean()
            .exec();
        const postCount = await Post.countDocuments(query).exec();
        ctx.set('Last-Page', Math.ceil(postCount / 10));
        ctx.body = posts.map(post => ({
            ...post,
            body: removeHtmlAndShorten(post.body),
        }));
    }catch(e){
        ctx.throw(500, e);
    }
};

// GET /api/posts/:id
export const read = async ctx => {
    ctx.body = ctx.state.post;
};

// DELETE /api/posts/:id
export const remove = async ctx => {
    const {id} = ctx.params;
    try{
        await Post.findByIdAndRemove(id).exec();
        ctx.status = 204;
    }catch(e){
        ctx.throw(500, e);
    }
};

// PATCH /api/posts/:id
export const update = async ctx => {
    const {id} = ctx.params;
    const schema = Joi.object().keys({
        title: Joi.string(),
        body: Joi.string(),
        tags: Joi.array().items(Joi.string())
    });

    const result = schema.validate(ctx.request.body);
    if(result.error){
        ctx.status = 400;
        ctx.body = result.error;
        return;
    }

    const nextData = {...ctx.request.body};
    if (nextData.body){
        nextData.body = sanitizeHtml(nextData.body, sanitizeOption);
    }

    try{
        const post = await Post.findByIdAndUpdate(id, nextData, {
            new: true,
        }).exec();
        if (!post){
            ctx.status = 404;
            return;
        }
        ctx.body = post;
    }catch(e){
        ctx.throw(500, e);
    }
};