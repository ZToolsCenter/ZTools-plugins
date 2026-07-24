trzsz
===

trz/tsz, 比lz/sz更强的终端传输工具

## 安装

在 Linux 中输入以下命令安装

```bash
echo '[trzsz]
name=Trzsz Repo
baseurl=https://yum.fury.io/trzsz/
enabled=1
gpgcheck=0' | sudo tee /etc/yum.repos.d/trzsz.repo

sudo yum install -y trzsz
```

## 实例

介绍几个常用场景

```bash
cd /root && trz
#指定上传目录
trz /root/

#选择文件夹上传 指定目录
trz -d /root/

#下载, 可以带一个或多个文件( 可使用相对路径或绝对路径, 也可使用通配符)
tsz file1 file2 file3

# -y 覆盖模式
trz -y 或 tsz -y xxx

# -b 二进制模式,对于压缩包、图片、影音等较快。
trz -b 或 tsz -b xxx

# -e 转义控制字符
trz -eb 或 tsz -eb xxx

# -t 超时时间(默认 20 秒),设置 0 或 负数, 则永不超时
trz -t 30
```


## 官网

更多安装使用方法可以访问：
https://github.com/trzsz/trzsz
https://github.com/trzsz/trzsz.js
https://github.com/trzsz/trzsz-go

