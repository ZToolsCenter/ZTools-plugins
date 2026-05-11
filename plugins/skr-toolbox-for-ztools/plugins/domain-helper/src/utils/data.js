import aliLogo from "@/assets/cloud/ali.png";
import cloudflareLogo from "@/assets/cloud/cloudflare.png";
import tencentLogo from "@/assets/cloud/tencent.png";
import huaweiLogo from "@/assets/cloud/huawei.png";
import awslogo from "@/assets/cloud/aws.png";
import volcengineLogo from "@/assets/cloud/volcengine.png";
import westLogo from "@/assets/cloud/west.png";
import spaceshipLogo from "@/assets/cloud/spaceship.png";
import ucloudLogo from "@/assets/cloud/ucloud.png";

export const cloudsData = [
    {
        name: "",
        key: "ali",
        title: "阿里云",
        color: "#FF6A00",
        icon: aliLogo,
        tokens: [
            {
                key: "ID",
                value: ""
            },
            {
                key: "Secret",
                value: ""
            }
        ],
        columns: [
            {
                title: '备注',
                dataIndex: 'Remark',
                key: 'Remark',
                align: 'center',
            },
            {
                title: '状态',
                dataIndex: 'Status',
                key: 'Status',
                width: 90,
                canEdit: true,
                align: 'center',
            },
        ],
        mx: {min: 1, max: 50},
        mx_default: 10,
        ttl: {min: 600, max: 86400},
        ttl_default: 600,
    },
    {
        name: "",
        title: "腾讯云",
        key: "tencent",
        color: "#006EFF",
        icon: tencentLogo,
        tokens: [
            {
                key: "Secret ID",
                value: ""
            },
            {
                key: "Secret Key",
                value: ""
            }
        ],
        columns: [
            {
                title: '备注',
                dataIndex: 'Remark',
                key: 'Remark',
                align: 'center',
            },
            {
                title: '状态',
                dataIndex: 'Status',
                width: 90,
                align: 'center',
                key: 'Status',
                canEdit: true,
            },
        ],
        mx: {min: 1, max: 20},
        mx_default: 10,
        ttl: {min: 600, max: 604800},
        ttl_default: 600,
    },
    {
        name: "",
        title: "华为云",
        key: "huawei",
        icon: huaweiLogo,
        color: "#EA020A",
        tokens: [
            {
                key: "主账号",
                value: ""
            },
            {
                key: "IAM 账号",
                value: ""
            },
            {
                key: "IAM 账号密码",
                value: ""
            }
        ],
        columns: [
            {
                title: '备注',
                dataIndex: 'Remark',
                key: 'Remark',
                align: 'center',
            },
            {
                title: '状态',
                dataIndex: 'Status',
                key: 'Status',
                width: 90,
                align: 'center',
                canEdit: true
            },
        ],
    },
    {
        name: "",
        title: "西部数码",
        key: "west",
        icon: westLogo,
        color: "#0080E3",
        tokens: [
            {
                key: "username",
                value: ""
            },
            {
                key: "api_password",
                value: ""
            }
        ],
        columns: [
            {
                title: '状态',
                dataIndex: 'Status',
                key: 'Status',
                width: 90,
                align: 'center',
                canEdit: true
            },
        ],
    },
    {
        name: "",
        title: "火山引擎",
        key: "volcengine",
        icon: volcengineLogo,
        color: "#1664FF",
        tokens: [
            {
                key: "Access Key ID",
                value: ""
            },
            {
                key: "Secret Access Key",
                value: ""
            }
        ],
        columns: [
            {
                title: '备注',
                dataIndex: 'Remark',
                key: 'Remark',
                align: 'center',
            },
            {
                title: '状态',
                dataIndex: 'Status',
                width: 90,
                align: 'center',
                key: 'Status',
                canEdit: true
            },
        ],
    },
    {
        name: "",
        title: "CloudFlare",
        color: "#FF6633",
        key: "cloudflare",
        icon: cloudflareLogo,
        tokens: [
            {
                key: "EMAIL",
                value: ""
            },
            {
                key: "API Key",
                value: ""
            },
            {
                key: "API Token",
                value: ""
            }
        ],
        desc: "<span class='key'>Token</span> 和 <span class='key'> Key,Email </span> 二选一，优先使用<span class='key'>Token</span>",
        columns: [
            {
                title: '备注',
                dataIndex: 'Remark',
                key: 'Remark',
                align: 'center',
            },
            {
                title: '代理状态',
                dataIndex: 'ProxyStatus',
                key: 'ProxyStatus',
                width: 140,
                align: 'center',
            },
        ],
        mx: {min: 0, max: 65535},
        mx_default: 100,
        ttl: {min: 60, max: 86400},
        ttl_default: 600,
    },
    {
        name: "",
        title: "AWS",
        key: "aws",
        icon: awslogo,
        color: "#FF9900",
        tokens: [
            {
                key: "Access key ID",
                value: ""
            },
            {
                key: "Secret access key",
                value: ""
            }
        ]
    },
    {
        name: "spaceship",
        title: "spaceship",
        key: "spaceship",
        icon: spaceshipLogo,
        color: "#394EFF",
        tokens: [
            {
                key: "Key",
                value: ""
            },
            {
                key: "Secret",
                value: ""
            }
        ]
    },
    {
        name: "",
        title: "UCloud",
        key: "ucloud",
        icon: ucloudLogo,
        color: "#3860F4",
        ttl: {min: 60, max: 86400},
        ttl_default: 600,
        tokens: [
            {
                key: "PublicKey",
                value: ""
            },
            {
                key: "PrivateKey",
                value: ""
            }
        ]
    }
]
export const RecordTypes = [
    "A",
    "CNAME",
    "TXT", "AAAA", "NS", "MX"
]

// 推送平台
export const platformTypes = {
    'ssh': {
        key: "ssh",
        name: "SSH",
        color: "#000",
        title: "SSH推送到服务器",
        config: {
            host: "",
            port: 22,
            username: "",
            password: "",
            privateKey: "",
            certPath: "",
            keyPath: "",
            restartCommand: "",
            beforePushCommand: "",
        },
    },
    'qiniu': {
        key: "qiniu",
        name: "七牛云",
        color: "#00AAE7",
        title: "七牛云平台",
        config: {
            accessKey: "",
            secretKey: "",
            cdnDomain: ""  // 可选},
        },
    },
    "ali": {
        key: "ali",
        name: "阿里云",
        color: "#FF6A00",
        title: "阿里云平台",
        config: {
            accessKey: "",
            secretKey: "",
            type: "SSL", // 类型 包括 SSL、 CDN、SLB、 ALB、DCDN、OSS
            cdn_domain: "",
            slb_id: "",
            slb_port: "",
            slb_region: "",
            alb_id: "",
            alb_port: "",
            alb_region: "",
            alb_protocol: "",
            dcdn_domain: "",
            oss_bucket: "",
            oss_region: undefined,
            oss_domain: "",
        },
    }
}