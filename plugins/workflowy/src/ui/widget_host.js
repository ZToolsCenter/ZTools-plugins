function createWidgetHostBridge(deps = {}) {
    const {
        workflowyApiRequest
    } = deps.workflowy || require('../api/workflowy');

    const buildHttpError = async (error) => {
        if (!error) return '未知错误';
        return error?.message || String(error);
    };

    const listChildNodes = async (parentId) => {
        const data = await workflowyApiRequest('nodes', { parent_id: parentId }, 'GET', true);
        return Array.isArray(data?.nodes) ? data.nodes : [];
    };

    const createChildNode = async ({ parentId, name, position }) => workflowyApiRequest(
        'nodes',
        { name, parent_id: parentId, position },
        'POST'
    );

    const toggleNodeComplete = async ({ nodeId, completed }) => workflowyApiRequest(
        `nodes/${nodeId}/${completed ? 'uncomplete' : 'complete'}`,
        {}
    );

    return {
        buildHttpError,
        listChildNodes,
        createChildNode,
        toggleNodeComplete
    };
}

module.exports = {
    createWidgetHostBridge
};
