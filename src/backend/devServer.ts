import { createBrowserOnlyDevServer } from '../electronUtils/browserOnlyHelpers.ts';
import { runWithRequestAbortSignal } from '../electronUtils/requestContext.ts';
import { apiMethods } from '../shared/apiMethods';
import { app } from './services/app';
import { useDb } from './services/database';

export const ready = createBrowserOnlyDevServer(app, apiMethods, useDb(), {
    runInRequestScope: (signal, task) => runWithRequestAbortSignal(signal, task),
});
