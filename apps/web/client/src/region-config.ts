import source from '../../../../config/catalog.json';
import {parseRegionConfig} from './catalog-validation.ts';

/** Names, default views and interface copy of every region, embedded at build time from config/catalog.json.
 * The on-disk version directory (see catalog-store.ts) only says which of them have data here. */
export const REGION_CONFIG=parseRegionConfig(source);
