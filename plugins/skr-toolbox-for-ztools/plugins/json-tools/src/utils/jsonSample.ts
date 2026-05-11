export const JsonSample = `{
    "user": {
        "id": 1234567890,
        "name": "张三",
        "nameBase64": "5byg5LiJMTI=",
        "nameUrlencoded": "%E5%BC%A0%E4%B8%89",
        "isActive": true,
        "profile": {
            "age": 29,
            "gender": "male",
            "address": {
                "country": "中国",
                "province": "北京",
                "city": "\\u671D\\u9633\\u533A",
                "details": "5YyX5Lqs5aSp5a6J6Zeo5bm/5Zy6",
                "createTime": 1750563586000
            }
        },
        "roles": [
            "admin",
            "editor",
            {
                "name": "custom",
                "permissions": [
                    "read",
                    "write",
                    {
                        "module": "\\u0066\\u0069\\u006E\\u0061\\u006E\\u0063\\u0065",
                        "access": [
                            "view",
                            "export"
                        ]
                    }
                ]
            }
        ]
    },
    "posts": [
        {
            "id": 101,
            "title": "第一篇文章",
            "contentUrlEncoded": "%E5%AE%9E%E7%8E%B0%E4%BB%85%E7%94%A8%E4%B8%80%E5%A5%97%E9%94%AE%E9%BC%A0%E6%93%8D%E6%8E%A7%E5%A4%9A%E5%8F%B0%E7%94%B5%E8%84%91%E3%80%82",
            "content": "5aaC5p6c5L2g6ZyA6KaB5ZyoIE1hY09T44CBTGludXgg5oiW6ICF5YW25LuW6K6+5aSH5LmL6Ze05YWx5Lqr6ZSu55uY5ZKM6byg5qCH77yM5L2g5pyJ5Lik56eN6YCJ5oup77ya5Y+v5Lul5L2/55So5aSa5aWX54us56uL55qE6ZSu6byg5aSW6K6+77yM5Lmf5Y+v5Lul5YCf5Yqp5LiA5qy+5byA5rqQ6L2v5Lu2IOKAlOKAlGRlc2tmbG9377yM5a6e546w5LuF55So5LiA5aWX6ZSu6byg5pON5o6n5aSa5Y+w55S16ISR44CC",
            "comments": [
                {
                    "user": "55So5oi3QQ==",
                    "text": "写得不错！",
                    "replies": []
                }
            ],
            "metadata": {
                "createdAt": "2024-06-01T08:00:00Z",
                "updatedAt": null,
                "views": 1234,
                "isPinned": false,
                "extra": {
                    "shares": 10
                }
            }
        },
        {
            "id": 102,
            "title": "第二篇文章",
            "content": "内容二。",
            "tags": [],
            "comments": [],
            "metadata": {
                "createdAt": "2024-06-02T09:00:00Z",
                "updatedAt": "2024-06-02T10:00:00Z",
                "views": 56,
                "isPinned": true,
                "extra": {
                    "shares": 0,
                    "devices": []
                }
            }
        }
    ],
    "logs": [
        {
            "timestamp": "1750563661",
            "level": "info",
            "message": "55So5oi355m75b2V5oiQ5Yqf",
            "context": {
                "userId": 1234567890,
                "ip": "192.168.1.1",
                "device": {
                    "type": "mobile",
                    "os": "iOS",
                    "version": "14.7"
                }
            }
        },
        {
            "timestamp": "2024-06-01T13:00:00Z",
            "level": "error",
            "message": "数据库连接失败",
            "context": null
        }
    ],
    "analytics": {
        "traffic": {
            "daily": [
                {
                    "date": "2024-06-01",
                    "visits": 100
                },
                {
                    "date": "2024-06-02",
                    "visits": 120
                }
            ],
            "sources": {
                "direct": 50,
                "referral": 30,
                "social": {
                    "wechat": 10,
                    "weibo": 15,
                    "twitter": 5,
                    "others": []
                }
            }
        },
        "userStats": {
            "newUsers": 12,
            "activeUsers": [
                1,
                2,
                3,
                4,
                5
            ],
            "churnedUsers": null
        }
    },
    "nullField": null
}`;
