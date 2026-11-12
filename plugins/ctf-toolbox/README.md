<div align="center">

<img src="logo.png" alt="logo" width="120" />

<p>一款面向 <a href="https://github.com/ZToolsCenter/ZTools">ZTools</a> / <a href="https://www.u-tools.cn/index.html">uTools</a> 插件：编码转换、哈希、JWT 解析、古典密码，以及公开 Payload 速查。</p>

<p><strong>仅用于 CTF、本地靶场和已获得书面授权的安全测试。</strong></p>

</div>

## 功能

- 编码 / 解码：Base64、Base64URL、Base32、Base58、Hex、URL、HTML 实体、Unicode、二进制、Quoted-Printable、ROT13、Caesar、Morse

<img src="images/t1.png" alt="编码/解码 t1" width="720" />

<img src="images/t2.png" alt="编码/解码 t2" width="720" />

- MD5 / SHA1 / SHA256 / SHA512，可选 HMAC-SHA256

<img src="images/t3.png" alt="哈希计算" width="720" />

- JWT Header / Payload 解析，none / HS256·384·512 / RS256·384·512 伪造签名（含弱密钥、算法混淆）

<img src="images/t4.png" alt="JWT 解析" width="720" />

- 古典密码：Caesar、ROT13、栅栏

<img src="images/t5.png" alt="古典密码" width="720" />

- PHP 绕过构造（独立栏目）：输入函数名，即时生成取反 / 异或 / 或 / 自增

<img src="images/t6.png" alt="PHP 绕过" width="720" />

- Payload 速查：PHP 伪协议、LFI、XSS、SSTI、SQLi、XXE、SSRF、上传绕过

<img src="images/t7.png" alt="Payload 速查" width="720" />

## 开始

### 安装

#### 方法一：在插件市场安装

在 ZTools 或 uTools 插件市场搜索 **网安 CTF 工具箱**，下载即可。

<img src="images/s1.png" alt="插件市场安装" width="720" />

#### 方法二：在 Releases 下载已经打包好的插件包安装

在 [Releases](https://github.com/LightPolarisCN/ctf-toolbox-web/releases) 下载插件包，下载好后点击导入本地插件。

<img src="images/s2.png" alt="导入本地插件" width="720" />

选择下载的插件包，点击安装即可。

<img src="images/s3.png" alt="选择插件包" width="720" />