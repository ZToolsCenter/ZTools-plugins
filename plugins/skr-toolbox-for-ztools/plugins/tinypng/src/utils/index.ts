export function toFileUrl(filePath: string) {
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function bytes(bytes: number) {
  if (bytes === 0) return '0B';
  let k = 1024;
  let sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function random(x: number, y: number): number;
export function random(str: string, length: number, repeat?: boolean): string;
export function random(str: string): string;
export function random<T>(arr: T[], length: number, repeat?: boolean): T[];
export function random<T>(arr: T[]): T;
export function random(x: any, y?: any, repeat = true) {
  if (typeof x === 'number') {
    return Math.floor(Math.random() * (y - x + 1)) + x;
  } else if (typeof x === 'string') {
    if (y === void 0) {
      return random(x.split(''));
    }
    return random(x.split(''), y, repeat).join('');
  } else if (x instanceof Array) {
    if (y === void 0) {
      return x[random(0, x.length - 1)];
    }
    if (!repeat && y > x.length) window.console.warn('"length" cannot be greater than "arr.length"'), (repeat = true);
    const o = [...x];
    const arr: any[] = [];
    for (let i = 0; i < y; i++) {
      const index = random(0, o.length - 1);
      arr.push(o[index]);
      if (!repeat) o.splice(index, 1);
    }
    return arr;
  } else {
    throw new Error('Type Error');
  }
}

export class Queue {
  private _list: Promise<any>[] = [];
  constructor(private max: number = 2) {}

  async push(promise: Promise<any>) {
    promise.finally(() => {
      const index = this._list.indexOf(promise);
      this._list.splice(index, 1);
    });

    this._list.push(promise);
    if (this._list.length >= this.max) await Promise.race([...this._list]);
    return Promise.resolve();
  }
  async finish() {
    return await Promise.all(this._list), Promise.resolve();
  }
}
