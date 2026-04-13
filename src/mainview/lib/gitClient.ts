import { GitClientRequestApi, GitClientRequestMap } from '../../electrobun';

const request = new Proxy({} as GitClientRequestApi, {
    get(_target, propertyKey) {
        return (params?: unknown) => window.gitClient.invoke(propertyKey as keyof GitClientRequestMap, params as GitClientRequestMap[keyof GitClientRequestMap]['params']);
    },
}) as GitClientRequestApi;

export const gitClientRpc = {
    request,
};
