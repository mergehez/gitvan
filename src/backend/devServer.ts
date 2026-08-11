import { createBrowserOnlyDevServer } from '../electronUtils/browserOnlyHelpers.ts';
import { apiMethods } from '../shared/apiMethods';
import { app } from './services/app';
import { useDb } from './services/database';

export const ready = createBrowserOnlyDevServer(app, apiMethods, useDb());
