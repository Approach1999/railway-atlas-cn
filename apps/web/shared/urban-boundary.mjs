// @ts-check
/**
 * @param {import('./atlas-types.ts').FilterState} state
 * @param {import('maplibre-gl').ExpressionSpecification} filteredTracks
 * @returns {import('maplibre-gl').ExpressionSpecification}
 */
export function urbanBoundaryFilter(state,filteredTracks){
  const modes=['subway','light_rail','tram'];
  // Non-urban presets exclude every urban mode. Their boundary cannot draw.
  if(state.preset!=='urban'&&state.preset!=='custom')return ['literal',false];
  if(state.preset==='custom'&&!modes.some(mode=>state.types.includes(mode)))return ['literal',false];
  return ['all',filteredTracks,['in',['get','rail_mode'],['literal',modes]]];
}
