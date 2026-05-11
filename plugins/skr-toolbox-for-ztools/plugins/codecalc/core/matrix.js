import Decimal from 'decimal.js';
import { Matrix, determinant, inverse, pseudoInverse, solve, EigenvalueDecomposition } from 'ml-matrix';


// https://mikemcl.github.io/decimal.js
// https://github.com/mljs/matrix


// 判断是否是标量
function isScalar(value) {
    return typeof value === 'number' || 
           typeof value === 'bigint' || 
           value instanceof Decimal;
}

// 定义一个复数矩阵，只用于显示
export class ComplexMatrix {
    constructor(data_r, data_i, rows, cols) {
        this.data_r = data_r.map(x => new Decimal(x).toFixed(6).replace(/\.?0+$/, ''));
        this.data_i = data_i.map(x => new Decimal(x).toFixed(6).replace(/\.?0+$/, ''));
        this.rows = rows;
        this.cols = cols;
    }

    toString() {
        // 如果data_i为0，则只显示实部
        let data = this.data_r.map((r, i) => {
            if (this.data_i[i] === '0') {
                return r;
            }
            let str = `${r} ${this.data_i[i] > 0 ? '+' : ''} ${this.data_i[i]}i`;
            // 将负号转换为减号
            return str.replace(/-/g, '− ');
        });

        // 如果只有一列，则返回向量
        if (this.cols === 1) {
            return `[${data.join(',')}]`;
        }

        // 将一维数组转换为二维数组
        let result = [];
        for(let i = 0; i < this.rows; i++) {
            let row = [];
            for(let j = 0; j < this.cols; j++) {
                row.push(data[i * this.cols + j]);
            }
            result.push(row.join(','));
        }

        return `{${result.join(';')}}`;
    }
}



// 定义一个类，存放Decimal数组
export class DecMatrix {
    constructor(data, rows, cols) {
        // 判断data是否是数组
        if (!Array.isArray(data)) {
            throw new Error('DMatrix: data 必须是数组');
        }
        
        // 判断data是否是二维数组
        if (Array.isArray(data[0])) {
            // 将二维数组转换为一维数组
            data = data.flat();
        }

        if(rows * cols <= 0){
            throw new Error(`DMatrix: 维度错误@rows * cols ${rows} * ${cols}`);
        }

        if (data.length !== rows * cols) {
            throw new Error(`DMatrix: data 的长度 ${data.length} 不等于 rows * cols ${rows} * ${cols}`);
        }

        // 判断data是否是Decimal数组
        if (!data.every(item => item instanceof Decimal)) {
            throw new Error('DMatrix: 数据类型必须是Decimal数组');
        }

        // 打印
        //console.log('DecMatrix@data:', data);
        //console.log(`DecMatrix@rows:${rows} cols:${cols}`);
        
        this.data = data; // 数据数组，如何判断是Decimal数组

        // 使用 !== 比较两个 Decimal 对象时，它比较的是对象引用而不是数值
        this.rows = Number(rows); // 行数
        this.cols = Number(cols); // 列数
    }

    clone() {
        return new DecMatrix([...this.data], this.rows, this.cols);
    }

    reshape(rows, cols) {
        // 判断行列是否相同
        if (this.rows * this.cols !== rows * cols) {
            throw new Error('reshape 数据长度不匹配');
        }

        //如果都相等，则直接返回
        if (this.rows === rows && this.cols === cols) {
            return this;
        }

        // 创建新的DecMatrix，注意这里是共用data
        // let result = new DecMatrix(this.data, rows, cols);

        // 不共享数据
        let result = new DecMatrix([...this.data], rows, cols);

        return result;
    }

    // 按行拼接矩阵，行数相加，列数相同, 矩阵向下拼接
    static concatRows(...args) {
        // 判断参数是否是DecMatrix类型
        if (!args.every(arg => arg instanceof DecMatrix)) {
            throw new Error('concatRows的参数必须是DecMatrix类型');
        }

        // 判断列数是否相同
        for(let i = 0; i < args.length; i++) {
            if (args[i].cols !== args[0].cols) {
                throw new Error('concatRows的列数不匹配');
            }
        }

        // 拼接行
        let result = [];
        for(let i = 0; i < args.length; i++) {
            result.push(...args[i].data);
        }

        // 计算所有矩阵的行数总和
        const totalRows = args.reduce((sum, matrix) => sum + matrix.rows, 0);
        return new DecMatrix(result, totalRows, args[0].cols);
    }

    // 按列拼接矩阵，行数相同，列数相加, 矩阵向右拼接
    static concatCols(...args) {
        // 判断参数是否是DecMatrix类型
        if (!args.every(arg => arg instanceof DecMatrix)) {
            throw new Error('concatCols的参数必须是DecMatrix类型');
        }

        // 判断行数是否相同
        for(let i = 0; i < args.length; i++) {
            if (args[i].rows !== args[0].rows) {
                throw new Error('concatCols的行数不匹配');
            }
        }

        // 拼接列
        let result = [];
        for(let i = 0; i < args[0].rows; i++) {
            for(let j = 0; j < args.length; j++) {
                for(let k = 0; k < args[j].cols; k++) {
                    result.push(args[j].data[i * args[j].cols + k]);
                }
            }
        }
        
        // 计算所有矩阵的列数总和
        const totalCols = args.reduce((sum, matrix) => sum + matrix.cols, 0);
        return new DecMatrix(result, args[0].rows, totalCols);
    }

    // 重复向量
    repeat(n) {
        n = Number(n);
        // 判断n是否是整数
        if (!Number.isInteger(n)) {
            throw new Error('repeat的次数必须是整数');
        }

        // 判断矩阵是否是行向量或列向量
        if (this.cols !== 1 && this.rows !== 1) {
            throw new Error('repeat的矩阵必须是行向量或列向量');
        }

        // 将数据重复n次
        let result = [];
        for (let i = 0; i < n; i++) {
            result.push(...this.data);
        }

        // 列向量
        if (this.cols == 1) {
            return new DecMatrix(result, this.rows, n).transpose();
        }

        // 行向量
        if (this.rows == 1) {
            return new DecMatrix(result, n, this.cols);
        }
        
    }

    // 排序,
    // order: 0:升序, 1:降序
    // axis: 0:行, 1:列
    // 默认按行升序排序
    sort(order=0, axis=0) {
        if(order == 0) {
            // 升序
            return new DecMatrix(this.data.sort((a, b) => a.minus(b)), this.rows, this.cols);
        }
        else {
            // 降序
            return new DecMatrix(this.data.sort((a, b) => b.minus(a)), this.rows, this.cols);
        }
    }

    apply(func, other) {
        // 同为DecMatrix
        if (other instanceof DecMatrix) {
            // 判断行列是否相同
            if (this.rows !== other.rows || this.cols !== other.cols) {
                throw new Error('行列不匹配');
            }

            // 创建新的DecMatrix
            let result = new DecMatrix(this.data.map((value, index) => func(value, other.data[index])), this.rows, this.cols);
            return result;
        }

        // 标量
        if (isScalar(other)) {
            // 创建新的DecMatrix
            let result = new DecMatrix(this.data.map(value => func(value, other)), this.rows, this.cols);
            return result;
        }

        throw new Error('不支持的矩阵运算');
    }

    // 对矩阵中的每个元素应用一个函数, 返回新的矩阵
    map(func){
        return new DecMatrix(this.data.map(func), this.rows, this.cols);
    }


    // 显示字符串
    toString() {
        //将数据转换为字符串，格式化成6位小数，去掉小数点后多余的0
        let data = this.data.map(value => value.toFixed(6).replace(/\.?0+$/, ''));

        // 如果只有一列，则返回向量
        if (this.cols === 1) {
            return `[${data.join(',')}]`;
        }

        // 将一维数组转换为二维数组
        let result = [];
        for(let i = 0; i < this.rows; i++) {
            let row = [];
            for(let j = 0; j < this.cols; j++) {
                row.push(data[i * this.cols + j]);
            }
            result.push(row.join(','));
        }

        return `{${result.join(';')}}`;
    }

    // 转成Matrix类型
    toMatrix() {
        // 将data按照rows和cols转换为二维数组
        let result = [];
        for(let i = 0; i < this.rows; i++) {
            let row = [];
            for(let j = 0; j < this.cols; j++) {
                // 获取一维数组中对应的元素
                let value = Number(this.data[i * this.cols + j]);
                row.push(value);
            }
            result.push(row);
        }
        return new Matrix(result);
    }

    // 定义全局静态方法, 从Matrix类型转换为DecMatrix类型
    static fromMatrix(matrix) {
        return new DecMatrix(matrix.to1DArray().map(x => new Decimal(x)), matrix.rows, matrix.columns);
    }

    // 提供矩阵运算方法
    matmul(other) {
        const m1 = this.toMatrix();
        const m2 = other.toMatrix();

        if (m1.columns !== m2.rows) {
            throw new Error('矩阵乘法：m1 的列数与 m2 的行数不匹配');
        }
    
        const rslt = m1.mmul(m2);
        return DecMatrix.fromMatrix(rslt);
    }

    // 转置
    transpose() {
        // 创建新的数组存储转置后的数据
        let transposed = new Array(this.data.length);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                // 原矩阵 (i,j) 位置的元素在转置矩阵中的位置是 (j,i)
                transposed[j * this.rows + i] = this.data[i * this.cols + j];
            }
        }
        return new DecMatrix(transposed, this.cols, this.rows);
    }

    // 求行列式
    determinant() {
        const m = this.toMatrix();
        return determinant(m);
    }

    // 求逆
    inverse() {
        const m = this.toMatrix();
        let rslt;

        if (m.rows !== m.columns) {
            // 伪逆
            console.log('矩阵不是方阵，使用伪逆');
            rslt = pseudoInverse(m);
        }
        else {
            // 行列式
            let det = determinant(m);
            if (Math.abs(det) < 1e-6) {
                // 矩阵不可逆，使用SVD求逆
                console.log('矩阵不可逆，使用SVD求逆');
                rslt = inverse(m, true); 
            }else{
                rslt = inverse(m); 
            }
        }

        return DecMatrix.fromMatrix(rslt);
    }

    // 特征值
    eigenvalues() {
        const m = this.toMatrix();
        const e = new EigenvalueDecomposition(m);
        const real = e.realEigenvalues;
        const imaginary = e.imaginaryEigenvalues;
        const vecs = DecMatrix.fromMatrix(e.eigenvectorMatrix);

        // console.log('特征值 实部：', real);
        // console.log('特征值 虚部：', imaginary);
        // console.log('特征向量：', vecs);

        // 将特征值和特征向量转换为复数矩阵
        const eigs = new ComplexMatrix(real, imaginary, real.length, 1);
        // console.log('复数矩阵：', eigs.toString());

        return {eigs, vecs};
    }

    // 解方程
    solve(x){
        if(x.cols != 1)
        {
            throw new Error("方程的右项需要是个向量");
        }

        if(this.rows != x.rows)
        {
            throw new Error("方程的左项和右项的行数不匹配");
        }

        const a = this.toMatrix();
        const b = x.toMatrix();

        let det = determinant(a);
        let rslt;

        // 奇异矩阵
        if (Math.abs(det) < 1e-6) {
            // 矩阵不可逆，使用SVD解方程
            console.log('矩阵不可逆，使用SVD解方程');
            rslt = solve(a, b, true); 
        }else{
            rslt = solve(a, b);
        }

        return DecMatrix.fromMatrix(rslt);
    }
    
}

