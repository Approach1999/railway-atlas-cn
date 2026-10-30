import type {ExpressionSpecification} from 'maplibre-gl';

// MapLibre requires camera zoom at the top-level interpolation. Add the same
// casing width to each stop instead of wrapping the zoom expression in '+'.
export function trackWidth(extra=0):ExpressionSpecification {
  return ['interpolate',['linear'],['zoom'],
    8,['match',['get','line_class'],'high_speed',1.8+extra,'conventional_main',1.4+extra,1+extra],
    14,['match',['get','line_class'],'high_speed',4+extra,'conventional_main',3.2+extra,'branch',1.6+extra,'industrial',1.4+extra,2.4+extra],
    18,5+extra];
}
