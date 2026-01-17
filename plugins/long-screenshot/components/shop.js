/**
 * 商店类，管理购买弹窗和会员状态
 */
class Shop {
    constructor() {
        if (Shop.instance) {
            return Shop.instance;
        }

        this.initialized = false;
        Shop.instance = this;

        // // 导入appStatus，在constructor中无法直接使用import语句
        // // 所以在组件加载后获取appStatus
        // document.addEventListener('DOMContentLoaded', () => {
        //     this.getAppStatus();
        //     // 初始化时刷新所有会员卡信息
        //     this.updateAllVipCards();
        // });

        // // 将弹窗HTML添加到页面
        // this.initShopPopup();
    }

    /**
     * 获取appStatus实例
     */
    getAppStatus() {
        // 通过自定义事件获取appStatus实例
        document.dispatchEvent(new CustomEvent('getAppStatus', {
            detail: {
                callback: (status) => {
                    this.appStatus = status;
                }
            }
        }));
    }

    /**
     * 初始化商店弹窗
     */
    initShopPopup() {
        if (this.initialized) return;

        // 创建弹窗HTML
        const popupHTML = `
        <div class="shop_popup" id="shop_popup">
            <span class="shop_popup_title">立即解锁所有 PRO 功能</span>
            <div class="vip_card" id="vip_card_set">
                <div class="vip_btn" id="vip_btn_set"></div>
                <img src="../assets/vip-badge.svg" alt="VIP 徽章" width="180" height="52" />
                <div class="vip_btn" id="vip_card_popup">立即解锁</div>
            </div>
            <div class="good" id="good_1day">
                <span>1 天订阅</span>
                <span>
                    <span class="rmb">¥</span>
                    0.1
                </span>
            </div>
            <div class="good" id="good_1year">
                <span>
                    一年订阅
                    <span class="discount">-56%</span>
                </span>
                <span>
                    <span class="rmb">¥</span>
                    16
                </span>
            </div>
            <div class="good" id="good_lifetime">
                <span>
                    终身会员
                    <span class="discount">-73%</span>
                </span>
                <span>
                    <span class="rmb">¥</span>
                    30
                </span>
            </div>
            <div class="cancel" id="shop_popup_close">关闭</div>
        </div>`;

        // 添加到body
        document.body.insertAdjacentHTML('beforeend', popupHTML);

        // 绑定事件
        document.getElementById('good_1day').addEventListener('click', () => this.subscribe(1));
        document.getElementById('good_1year').addEventListener('click', () => this.subscribe(365));
        document.getElementById('good_lifetime').addEventListener('click', () => this.subscribe(1000));
        document.getElementById('shop_popup_close').addEventListener('click', (event) => this.closePopup(event));

        // 标记为已初始化
        this.initialized = true;
    }

    /**
     * 更新所有会员卡信息
     */
    updateAllVipCards() {
        // 获取会员信息
        const vipText = this.refreshPopup();

        // 更新所有会员卡信息
        const vipCardElements = document.querySelectorAll('.vip_btn');
        vipCardElements.forEach(element => {
            // 只更新id包含detil的元素(主页面卡片)或id为vip_card_popup的元素(弹窗内卡片)
            if (element.id && (element.id.includes('detil') || element.id === 'vip_card_popup')) {
                element.innerText = vipText;
            }
        });
    }

    /**
     * 检查是否为专业用户
     */
    isProUser() {
        // const purchasedUser = ztools.isPurchasedUser();
        // if (!purchasedUser) {
        //     this.showPopup();
        //     return false;
        // } else {
        return true;
        // }
    }

    /**
     * 显示购买弹窗
     */
    showPopup() {
        this.refreshPopup();
        document.getElementById("shop_popup").style.display = "flex";

        // 设置应用状态为shop
        if (this.appStatus) {
            this.appStatus.status = "shop";
        } else {
            // 如果appStatus尚未获取，重新尝试获取并设置状态
            this.getAppStatus();
            // 通过全局window对象查找appStatus
            if (window.appStatus) {
                window.appStatus.status = "shop";
            }
        }
    }

    /**
     * 刷新弹窗状态
     */
    refreshPopup(purchased = null) {
        console.log("refreshPopup", purchased);
        let purchasedUser = ztools.isPurchasedUser();
        if (purchased !== null) {
            purchasedUser = purchased;
        }

        let vipText = "立即解锁";

        if (purchasedUser) {
            if (purchasedUser === true) {
                // 永久会员
                vipText = "永久激活";
                document.getElementsByClassName("shop_popup_title")[0].innerText = "欢迎，尊贵的永久会员";

                // 隐藏所有购买按钮
                document.querySelectorAll(".good").forEach((btn) => {
                    btn.style.display = "none";
                });
                document.getElementById("vip_card_popup").classList.remove("vip_card_unactive");

            } else {
                // 订阅会员
                // purchasedUser="yyyy-mm-dd hh:mm:ss"
                // 计算剩余天数小时数
                const now = new Date();
                const purchasedDate = new Date(purchasedUser);
                const diff = purchasedDate - now;
                const days = Math.floor(diff / (24 * 3600 * 1000));
                const hours = ((diff % (24 * 3600 * 1000)) / (3600 * 1000)).toFixed(1); // 小时保留1位小数

                // 如果天数为0，则不显示天数部分
                vipText = days > 0 ? `剩余 ${days} 天 ${hours} 小时` : `剩余 ${hours} 小时`;

                document.getElementById("vip_card_popup").innerHTML = vipText;
                document.getElementsByClassName("shop_popup_title")[0].innerText = "欢迎续订，尊贵的会员";
                document.getElementById("vip_card_popup").classList.remove("vip_card_unactive");
            }
        } else {
            // 未购买
            document.getElementById("vip_card_popup").classList.add("vip_card_unactive");
            document.getElementsByClassName("shop_popup_title")[0].innerText = "立即解锁所有 PRO 功能";
        }

        return vipText;
    }

    /**
     * 计算会员过期时间戳（秒级）
     */
    getExpireTimestamp() {
        const purchasedUser = ztools.isPurchasedUser();
        if (purchasedUser) {
            if (purchasedUser === true) {
                return -1;
            } else {
                const purchasedDate = new Date(purchasedUser);
                return Math.floor(purchasedDate.getTime() / 1000);
            }
        } else {
            return 0;
        }
    }

    /**
     * 关闭弹窗
     */
    closePopup(event) {
        event.stopPropagation();
        document.getElementById("shop_popup").style.display = "none";

        // 将应用状态恢复为pause
        if (this.appStatus) {
            this.appStatus.restoreAfterShop();
        } else {
            // 如果appStatus尚未获取，尝试通过全局window对象恢复状态
            if (window.appStatus) {
                window.appStatus.restoreAfterShop();
            }
        }

        // 刷新所有会员卡信息
        this.updateAllVipCards();
    }

    /**
     * 订阅购买
     */
    subscribe(days) {
        switch (days) {
            case 1:
                ztools.openPurchase({ goodsId: "aiPADauHLZOirVrZhsRBjZlih3ZPUCgS" }, () => {
                    console.log("已购买成功");
                    setTimeout(() => {
                        this.refreshPopup();
                        this.updateAllVipCards();
                        this.closePopup({ stopPropagation: () => { } }); // 自动关闭弹窗
                    }, 2000);
                });
                break;
            case 7:
                ztools.openPurchase({ goodsId: "ndlUXbMTAQuDps73sGl9mZXv1U9rMMsL" }, () => {
                    console.log("已购买成功");
                    setTimeout(() => {
                        this.refreshPopup();
                        this.updateAllVipCards();
                        this.closePopup({ stopPropagation: () => { } }); // 自动关闭弹窗
                    }, 2000);
                });
                break;
            case 30:
                ztools.openPurchase({ goodsId: "8Wy9RixmJSqhfcan6zKYhG3SgrfLNyEP" }, () => {
                    console.log("已购买成功");
                    setTimeout(() => {
                        this.refreshPopup();
                        this.updateAllVipCards();
                        this.closePopup({ stopPropagation: () => { } }); // 自动关闭弹窗
                    }, 2000);
                });
                break;
            case 365:
                ztools.openPurchase({ goodsId: "e90NqvRlXyfig2y14J2k62dwiteJe6bh" }, () => {
                    console.log("已购买成功");
                    setTimeout(() => {
                        this.refreshPopup();
                        this.updateAllVipCards();
                        this.closePopup({ stopPropagation: () => { } }); // 自动关闭弹窗
                    }, 2000);
                });
                break;
            case 1000:
                ztools.openPurchase({ goodsId: "uTHVK74mFfzDZFbUXPEyq0qMJe7I7FK0" }, () => {
                    console.log("已购买成功");
                    setTimeout(() => {
                        this.refreshPopup();
                        this.updateAllVipCards();
                        this.closePopup({ stopPropagation: () => { } }); // 自动关闭弹窗
                    }, 2000);
                });
                break;
        }
    }
}

// 创建全局单例并导出
const shopInstance = new Shop();

// 导出公共方法供其他模块使用
const isProUser = () => shopInstance.isProUser();
const showPopup = () => shopInstance.showPopup();
const refreshPopup = (purchased) => shopInstance.refreshPopup(purchased);
const getExpireTimestamp = () => shopInstance.getExpireTimestamp();
const closePopup = (event) => shopInstance.closePopup(event);
const subscribe = (days) => shopInstance.subscribe(days);

// 导出这些方法
export { isProUser, showPopup, refreshPopup, getExpireTimestamp, closePopup, subscribe };
// 同时导出类和单例
export { Shop, shopInstance as default };


