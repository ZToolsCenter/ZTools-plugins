const DouYinParser = require('./douyin');
const RedBookParser = require('./redbook');
const JiMengParser = require('./jimeng');
const ZuiYouParser = require('./zuiyou');
const BiliBiliParser = require('./bilibili');
const KuaishouParser = require('./kuaishou');
const DouBaoParser = require('./doubao');
const WxParser = require('./wx');
const PipixiaParser = require('./pipixia');

/**
 * 解析信息
 * @param {string} sharedUrl 分享链接
 */
async function parseInfo(sharedUrl) {
  if (sharedUrl.includes('douyin.com')) {
    return await new DouYinParser().parse(sharedUrl);
  } else if (sharedUrl.includes('xiaohongshu.com') || sharedUrl.includes('xhslink.com')) {
    return await new RedBookParser().parse(sharedUrl);
  } else if (sharedUrl.includes('jimeng.jianying.com')) {
    return await new JiMengParser().parse(sharedUrl);
  } else if (sharedUrl.includes('xiaochuankeji.cn')) {
    return await new ZuiYouParser().parse(sharedUrl);
  } else if (sharedUrl.includes('bilibili.com') || sharedUrl.includes('b23.tv')) {
    return await new BiliBiliParser().parse(sharedUrl);
  } else if (sharedUrl.includes('kuaishou.com')) {
    return await new KuaishouParser().parse(sharedUrl);
  } else if (sharedUrl.includes('doubao.com')) {
    return await new DouBaoParser().parse(sharedUrl);
  } if (sharedUrl.includes('mp.weixin.qq.com')) {
    return await new WxParser().parse(sharedUrl);
  } if (sharedUrl.includes('pipix.com')) {
    return await new PipixiaParser().parse(sharedUrl);
  } else {
    throw new Error("暂不支持该平台");
  }
}

module.exports = { parseInfo }