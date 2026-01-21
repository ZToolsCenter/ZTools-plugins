export class IPushStrategy {
    async validate() {
        throw new Error('需要实现validate方法');
    }
    
    async push(certData) {
        throw new Error('需要实现push方法');
    }
} 