import copy
import unittest
from pathlib import Path
import json

from mvp_data import normalize_relations, station_anchor, inside

PALETTE = json.loads((Path(__file__).resolve().parents[1] / 'config/line-colors.json').read_text(encoding='utf-8'))


def feature(key, kind='track', mode='subway'):
    return {'id': key, 'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [123.4,41.8]},
        'properties': {'osm_id': key, 'feature_kind': kind, 'rail_mode': mode, 'display_name': '同名'}}


def route(identifier, ref='1', members=('way/1',), operator='沈阳地铁', missing=()):
    return {'feature_key': f'relation/{identifier}', 'tags': {'route':'subway','operator':operator,'ref':ref},
        'members':[{'feature_key':key,'present':key not in missing,'role':''} for key in members]}


class MembershipTests(unittest.TestCase):
    def master(self, identifier, children, ref='2', network='沈阳地铁', mode='subway'):
        return {'feature_key':f'relation/{identifier}','tags':{'type':'route_master','route_master':mode,'network':network,'ref':ref,'name':'源线路名称'},
            'members':[{'feature_key':f'relation/{key}','present':True,'role':''} for key in children]}

    def test_explicit_master_supplies_missing_identity_without_changing_source_tags(self):
        f=feature('way/1');a=route(1,ref='2',operator='');b=route(2,ref='',operator='')
        original=copy.deepcopy([a,b])
        lines=normalize_relations([f],[a,b,self.master(10,[1,2])],PALETTE)
        self.assertEqual(len(lines),1);self.assertEqual(lines[0]['line_key'],'shenyang-metro/2')
        self.assertEqual(lines[0]['master_ids'],['relation/10']);self.assertFalse(f['properties']['line_shared'])
        self.assertEqual(f['properties']['line_color'],'#F08439');self.assertEqual([a,b],original)

    def test_unknown_network_uses_master_typed_identity_and_tram_mode_color(self):
        f=feature('way/1',mode='tram');a=route(1,ref='2',operator='');b=route(2,ref='',operator='')
        a['tags']['route']=b['tags']['route']='tram';a['tags']['colour']=b['tags']['colour']='#FF0000'
        lines=normalize_relations([f],[a,b,self.master(10,[1,2],network='源有轨电车网络',mode='tram')],PALETTE)
        self.assertEqual(len(lines),1);self.assertEqual(lines[0]['line_key'],'osm/relation/10')
        self.assertFalse(f['properties']['line_shared']);self.assertEqual(f['properties']['line_color'],PALETTE['fallbacks']['tram'])

    def test_conflicting_masters_do_not_choose_by_input_order(self):
        f=feature('way/1');a=route(1,ref='',operator='')
        lines=normalize_relations([f],[a,self.master(10,[1],ref='1'),self.master(20,[1],ref='2')],PALETTE)
        self.assertEqual(lines[0]['line_key'],'osm/relation/1');self.assertTrue(lines[0]['identity_warnings'])

    def test_master_does_not_override_explicit_ref_or_incompatible_mode(self):
        f=feature('way/1');a=route(1,ref='3',operator='')
        lines=normalize_relations([f],[a,self.master(10,[1],ref='2')],PALETTE)
        self.assertEqual(lines[0]['line_key'],'osm/relation/1')
        lines=normalize_relations([feature('way/1')],[a,self.master(20,[1],ref='3',mode='tram')],PALETTE)
        self.assertEqual(lines[0]['master_ids'],[])

    def test_directions_share_line_identity_not_false_shared_segment(self):
        f=feature('way/1')
        lines=normalize_relations([f],[route(1),route(2)],PALETTE)
        self.assertEqual(len(lines),1)
        self.assertEqual(lines[0]['relation_ids'],['relation/1','relation/2'])
        self.assertFalse(f['properties']['line_shared'])
        self.assertEqual(f['properties']['line_color'],'#E5001C')

    def test_stop_areas_link_interchange_poi_without_cross_contaminating_platforms(self):
        station=feature('node/1',kind='station',mode='subway')
        rail=feature('node/2',kind='station',mode='rail')
        a=feature('node/3',kind='facility',mode='subway');b=feature('node/4',kind='facility',mode='subway')
        areas=[{'feature_key':f'relation/{identifier}','tags':{'public_transport':'stop_area'},
            'members':[{'feature_key':key,'present':True,'role':''} for key in keys]}
            for identifier,keys in [(20,['node/1','node/2','node/3']),(40,['node/1','node/4'])]]
        normalize_relations([station,rail,a,b],[route(2,ref='2',members=('node/3',)),route(4,ref='4',members=('node/4',)),*areas],PALETTE)
        self.assertEqual(station['properties']['line_keys'],['shenyang-metro/2','shenyang-metro/4'])
        self.assertEqual(station['properties']['line_membership_source'],'stop_area relation')
        self.assertEqual(a['properties']['line_keys'],['shenyang-metro/2'])
        self.assertEqual(b['properties']['line_keys'],['shenyang-metro/4'])
        self.assertEqual(rail['properties']['line_keys'],[])

    def test_shared_segment_uses_fallback_and_retains_both_lines(self):
        f=feature('way/1')
        normalize_relations([f],[route(1),route(2,ref='2')],PALETTE)
        self.assertEqual(f['properties']['line_keys'],['shenyang-metro/1','shenyang-metro/2'])
        self.assertEqual(f['properties']['line_color'],PALETTE['fallbacks']['subway'])
        self.assertTrue(f['properties']['line_shared'])

    def test_operator_not_inferred_from_number_or_bbox(self):
        f=feature('way/1')
        lines=normalize_relations([f],[route(1,operator='')],PALETTE)
        self.assertEqual(lines[0]['line_key'],'osm/relation/1')
        self.assertEqual(f['properties']['colour_confidence'],'fallback')

    def test_incomplete_relations_cannot_claim_uniquely_colored_segment(self):
        f=feature('way/1')
        lines=normalize_relations([f],[route(1,members=('way/1','way/9'),missing=('way/9',))],PALETTE)
        self.assertEqual(lines[0]['completeness'],'missing_references')
        self.assertEqual(f['properties']['line_color'],PALETTE['fallbacks']['subway'])

    def test_relation_color_override_is_separate_from_classification(self):
        f=feature('way/1');p=copy.deepcopy(PALETTE)
        p['overrides']=[{'relation_id':1,'color':'#123456','source':'fixture'}]
        normalize_relations([f],[route(1)],p)
        self.assertEqual(f['properties']['line_color'],'#123456')
        self.assertEqual(f['properties']['colour_confidence'],'manual')

    def test_route_does_not_paint_walking_member_as_subway_track(self):
        f=feature('way/1',mode='other')
        normalize_relations([f],[route(1)],PALETTE)
        self.assertEqual(f['properties']['line_keys'],[])

    def test_only_explicit_stop_area_confirms_station_links(self):
        station=feature('node/1',kind='station',mode='unknown')
        platform=feature('way/2',kind='facility',mode='unknown')
        normalize_relations([station,platform],[],PALETTE)
        self.assertNotIn('link_status',platform['properties'])
        relation={'feature_key':'relation/10','tags':{'public_transport':'stop_area'},
            'members':[{'feature_key':key,'present':True,'role':''} for key in ['node/1','way/2']]}
        normalize_relations([station,platform],[relation],PALETTE)
        self.assertEqual(platform['properties']['link_status'],'confirmed')
        self.assertEqual(platform['properties']['station_links'],['node/1'])

    def test_concave_station_anchor_is_inside_not_bbox_center(self):
        ring=[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4],[0,0]]
        point,method=station_anchor({'type':'Polygon','coordinates':[ring]})
        self.assertTrue(inside(point,ring))
        self.assertNotEqual(point,[2,2])
        self.assertIn('interior',method)


if __name__=='__main__': unittest.main()
