import {StorageDataStructure, StorageDataStructureInterface, StorageInterface} from "ctool-config";

const PREFIX = "_system_"

const keyName = (key: string) => {
    return `${PREFIX}${key}`
}

class storage implements StorageInterface {
    get<T>(key: string): StorageDataStructure<T> {
        // @ts-ignore
        return window.ztools.dbStorage.getItem(keyName(key)) || ""
    }

    set<T>(key: string, value: StorageDataStructureInterface<T>): void {
        // @ts-ignore
        window.ztools.dbStorage.setItem(keyName(key), value)
    }

    remove(key: string): void {
        // @ts-ignore
        window.ztools.dbStorage.removeItem(keyName(key))
    }

    clear() {
        for (let key of this.getAllKey()) {
            this.remove(key)
        }
    }

    getAllKey(): string[] {
        // @ts-ignore
        return window.ztools.db.allDocs(PREFIX).map(({_id}) => {
            return _id.replace(PREFIX, "");
        })
    }
}

export default new storage()
