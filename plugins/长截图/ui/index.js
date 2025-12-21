// 导入Shop组件中的函数
import { refreshPopup, showPopup } from '../components/shop.js';

// 在DOMContentLoaded事件中初始化
document.addEventListener('DOMContentLoaded', () => {
    // 设置会员卡信息
    updateVipCardInfo();
    
    // 添加点击事件监听器，显示购买弹窗
    document.getElementById('vip_card_set').addEventListener('click', () => {
        showPopup();
    });
    
    // 每10秒刷新一次会员卡信息，确保显示最新状态
    setInterval(updateVipCardInfo, 10000);
});

// 更新会员卡信息
function updateVipCardInfo() {
    const vipCardElement = document.getElementById('vip_card_detil_set');
    if (vipCardElement) {
        vipCardElement.innerText = refreshPopup();
    }
}