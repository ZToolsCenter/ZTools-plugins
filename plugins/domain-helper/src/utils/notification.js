import {randomString} from "@/utils/tool";

const notificationPrefix = "notification"

export function addNotification(title, content) {
    const id = Date.now() + randomString(6);
    const notification = {
        id,
        title,
        content,
        time: new Date().toLocaleString(),
        isRead: false,
        checked: false
    };

    const key = `${notificationPrefix}/${id}`;
    notification._id = key;
    utools.dbStorage.setItem(key, notification);
    return notification;
}

export function getAllNotification() {
    const allDocs = utools.db.allDocs(notificationPrefix);
    return allDocs.map(doc => ({
        ...doc.value,
        _id: doc._id
    })).reverse()
}

export function deleteNotification(id) {
    utools.dbStorage.removeItem(`${notificationPrefix}/${id}`);
}

export function batchDeleteNotifications(ids) {
    const allDocs = utools.db.allDocs(notificationPrefix);
    ids.forEach(id => {
        const doc = allDocs.find(doc => doc.value.id === id);
        if (doc) {
            utools.dbStorage.removeItem(doc._id);
        }
    });
}

export function markAsRead(id) {
    const allDocs = utools.db.allDocs(notificationPrefix);
    const doc = allDocs.find(doc => doc.value.id === id);

    if (doc) {
        const notification = doc.value;
        notification.isRead = true;
        utools.dbStorage.setItem(doc._id, notification);
    }
}

export function batchMarkAsRead(ids) {
    const allDocs = utools.db.allDocs(notificationPrefix);
    const docsToUpdate = allDocs.filter(doc => ids.includes(doc.value.id));

    docsToUpdate.forEach(doc => {
        const notification = doc.value;
        notification.isRead = true;
        utools.dbStorage.setItem(doc._id, notification);
    });
}

export function getUnreadCount() {
    const allDocs = utools.db.allDocs(notificationPrefix);
    return allDocs.filter(doc => !doc.value.isRead).length;
}