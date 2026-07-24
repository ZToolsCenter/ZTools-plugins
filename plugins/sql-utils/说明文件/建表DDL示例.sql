create table movies
(
    id             varchar(64)    not null comment '主键id'
        primary key,
    title          varchar(200)   not null comment '名称',
    release_year   year           null comment '上映年份',
    director       varchar(64)    null comment '导演',
    duration       decimal(5, 2)  null comment '时长（分钟）',
    genre          varchar(100)   null comment '类型（动作、喜剧、科幻等，逗号分隔）',
    rating         decimal(3, 1)  null comment '评分（0.0~10.0）',
    country        varchar(64)    null comment '制片国家/地区',
    language       varchar(32)    null comment '语言',
    description    varchar(1000)  null comment '简介',
    poster_url     varchar(500)   null comment '海报图片URL',
    box_office     decimal(12, 2) null comment '票房（万元）',
    status         tinyint        not null default 1 comment '状态（0-禁用 1-启用）',
    sort_order     int            not null default 0 comment '排序号',
    is_deleted     tinyint(1)     not null default 0 comment '是否删除（0-未删除 1-已删除）',
    deleted_at     datetime       null comment '删除时间',
    created_by     varchar(64)    null comment '创建人',
    created_at     datetime       not null default current_timestamp comment '创建时间',
    updated_by     varchar(64)    null comment '更新人',
    updated_at     datetime       not null default current_timestamp on update current_timestamp comment '更新时间'
) comment '电影基本信息';
