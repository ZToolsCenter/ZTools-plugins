const ASTVisualizer = (function() {
    class ASTVisualizer {
        constructor(container) {
            this.container = container;
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d');
            this.container.appendChild(this.canvas);
            
            // 设置基本样式
            this.nodeRadius = 25;
            this.levelHeight = 80;
            this.minNodeSpacing = 60;
            this.fontSize = 14;
            
            // 颜色配置
            this.colors = {
                operator: '#4CAF50',  // 运算符节点
                number: '#2196F3',    // 数字节点
                function: '#FF9800',  // 函数节点
                text: '#FFFFFF',      // 文本颜色
                line: '#666666'       // 连线颜色
            };
        }

        draw(ast) {
            if (!ast) return;

            // 计算树的尺寸
            const treeSize = this._calculateTreeSize(ast);
            
            // 设置画布尺寸
            this.canvas.width = treeSize.width + 40;  // 添加边距
            this.canvas.height = treeSize.height + 40;
            
            // 清空画布
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            // 绘制树
            this._drawNode(ast, this.canvas.width / 2, 30, treeSize.width);
        }

        _calculateTreeSize(node) {
            if (!node) return { width: 0, height: 0 };

            // 如果是叶子节点
            if (!node.args || node.args.length === 0) {
                return { width: this.minNodeSpacing, height: this.levelHeight };
            }

            // 计算所有子节点的尺寸
            const childSizes = node.args.map(child => this._calculateTreeSize(child));
            
            // 计算总宽度
            const totalWidth = Math.max(
                this.minNodeSpacing,
                childSizes.reduce((sum, size) => sum + size.width, 0)
            );
            
            // 计算高度
            const maxChildHeight = Math.max(...childSizes.map(size => size.height));
            const height = this.levelHeight + maxChildHeight;

            return { width: totalWidth, height: height };
        }

        _drawNode(node, x, y, availableWidth) {
            if (!node) return;

            // 设置节点颜色
            let color = this.colors.number;
            if (typeof node.value === 'string') {
                color = node.args.length > 0 ? this.colors.function : this.colors.operator;
            }

            // 绘制节点
            this.ctx.beginPath();
            this.ctx.fillStyle = color;
            this.ctx.arc(x, y, this.nodeRadius, 0, Math.PI * 2);
            this.ctx.fill();

            // 绘制文本
            this.ctx.fillStyle = this.colors.text;
            this.ctx.font = `${this.fontSize}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(node.value.toString(), x, y);

            // 如果有子节点，递归绘制
            if (node.args && node.args.length > 0) {
                const childWidth = availableWidth / node.args.length;
                let startX = x - (availableWidth / 2) + (childWidth / 2);

                node.args.forEach((child, index) => {
                    const childX = startX + childWidth * index;
                    const childY = y + this.levelHeight;

                    // 绘制连线
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = this.colors.line;
                    this.ctx.moveTo(x, y + this.nodeRadius);
                    this.ctx.lineTo(childX, childY - this.nodeRadius);
                    this.ctx.stroke();

                    // 递归绘制子节点
                    this._drawNode(child, childX, childY, childWidth);
                });
            }
        }
    }

    return ASTVisualizer;
})();

// 暴露到全局作用域
window.ASTVisualizer = ASTVisualizer; 