export class DbAcmeAccount {
    constructor() {
        this.prefix = 'acme_account';
    }

    getAccount(brand, defaultData = {}) {
        const dataKey = `${this.prefix}/${brand}`;
        return utools.dbStorage.getItem(dataKey) || defaultData;
    }

    saveAccount(brand, data) {
        const dataKey = `${this.prefix}/${brand}`;
        utools.dbStorage.setItem(dataKey, data);
    }
}