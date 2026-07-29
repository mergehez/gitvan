import { homedir } from 'os';
import { join } from 'path';
import { createBrowserOnlyDevServer } from '../electronUtils/browserOnlyHelpers.ts';
import { apiMethods } from '../shared/apiMethods';
import { app } from './services/app';
import { useDb } from './services/database';

// Initialize database (normally done by the Electrobun entrypoint)
const userDataDir = process.env.GITVAN_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'gitvan');
useDb().configureDatabase(userDataDir);

export const ready = createBrowserOnlyDevServer(app, apiMethods, useDb().configureDatabase);
