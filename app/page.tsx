'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

type Coordinate = [number, number];
type RoutePoint = { coord: Coordinate; time: number; mode: string; seg: number; day: string };
type Segment = { points: RoutePoint[]; mode: string };
type Place = { coord: Coordinate; label: string; time: number };
type Story = { date: string; endDate: string; days: number; route: RoutePoint[]; segments: Segment[]; places: Place[]; distanceKm: number; dayRanges: [number,number][] };

const MAX_POINTS = 6000;
const HULL_SAMPLE = 700;
const TRAIL_FRACTION = 0.18;
const TRAIL_BANDS = 26;

const emptyStory: Story = { date: '', endDate: '', days: 1, route: [], segments: [], places: [], distanceKm: 0, dayRanges: [] };

function parseCoordinate(value: unknown): Coordinate | null {
  const text = typeof value === 'string' ? value : value && typeof value === 'object' && 'latLng' in value ? String((value as {latLng?:unknown}).latLng ?? '') : '';
  const values = text.replace('geo:','').match(/-?\d+(?:\.\d+)?/g); if (!values || values.length < 2) return null;
  const lat=Number(values[0]), lon=Number(values[1]); return Number.isFinite(lat)&&Number.isFinite(lon)?[lon,lat]:null;
}
function meters(a:Coordinate,b:Coordinate){const lat=(a[1]+b[1])/2*Math.PI/180;return Math.hypot((a[0]-b[0])*111320*Math.cos(lat),(a[1]-b[1])*111320);}
function clock(time:number){return new Date(time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}).toLowerCase();}
function dayKey(time:number){return new Date(time+7*3600000).toISOString().slice(0,10);}
function daysBetween(a:string,b:string){return Math.max(1,Math.round((new Date(`${b}T12:00:00Z`).getTime()-new Date(`${a}T12:00:00Z`).getTime())/86400000)+1);}

function thin(points:RoutePoint[],minMeters:number):RoutePoint[]{
  const out:RoutePoint[]=[];
  for(const point of points)if(!out.length||meters(out[out.length-1].coord,point.coord)>minMeters)out.push(point);
  if(points.length>1&&out.length===1)out.push(points[points.length-1]);
  return out;
}

function storyFromTimeline(data:any,startDate:string,endDate:string,from:string,to:string):Story{
  const startMs=new Date(`${startDate}T${from}:00+07:00`).getTime(),endMs=new Date(`${endDate}T${to}:59+07:00`).getTime();
  const segmentsRaw=Array.isArray(data)?data:data?.semanticSegments??[];const raw:RoutePoint[]=[];const activities:any[]=[];const visits:any[]=[];
  for(const item of segmentsRaw){const start=new Date(item?.startTime).getTime(),end=new Date(item?.endTime).getTime();if(!Number.isFinite(start)||!Number.isFinite(end)||end<startMs||start>endMs)continue;
    for(const path of item?.timelinePath??[]){const coord=parseCoordinate(path?.point),time=new Date(path?.time).getTime();if(coord&&Number.isFinite(time)&&time>=startMs&&time<=endMs)raw.push({coord,time,mode:'UNKNOWN',seg:0,day:''});}
    if(item?.activity){const a=item.activity,s=parseCoordinate(a.start),e=parseCoordinate(a.end),distance=Number(a.distanceMeters??0),mode=String(a?.topCandidate?.type??'UNKNOWN');if(s&&e&&distance>=40)activities.push({start,end,s,e,distance,mode});}
    const candidate=item?.visit?.topCandidate,coord=parseCoordinate(candidate?.placeLocation);if(coord)visits.push({coord,start:Math.max(start,startMs),end:Math.min(end,endMs),semantic:String(candidate?.semanticType??'UNKNOWN')});
  }
  raw.sort((a,b)=>a.time-b.time);
  let segments:Segment[]=[];let distanceKm=0;let pointer=0;
  for(const a of activities.sort((x,y)=>x.start-y.start)){
    const lower=a.start-60000,upper=a.end+60000;
    while(pointer>0&&raw[pointer-1].time>=lower)pointer--;
    while(pointer<raw.length&&raw[pointer].time<lower)pointer++;
    const inner:RoutePoint[]=[];
    for(let i=pointer;i<raw.length&&raw[i].time<=upper;i++)inner.push({...raw[i],mode:a.mode});
    const points=[{coord:a.s,time:a.start,mode:a.mode,seg:0,day:''},...inner,{coord:a.e,time:a.end,mode:a.mode,seg:0,day:''}].sort((x,y)=>x.time-y.time);
    const clean=thin(points,8);
    if(clean.length>1){segments.push({points:clean,mode:a.mode});distanceKm+=a.distance/1000;}
  }
  if(!segments.length&&raw.length>1){
    const byDay=new Map<string,RoutePoint[]>();
    for(const point of raw){const key=dayKey(point.time);const list=byDay.get(key);if(list)list.push(point);else byDay.set(key,[point]);}
    for(const list of [...byDay.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(entry=>entry[1])){
      const clean:RoutePoint[]=[];
      for(const point of list){const gap=clean.length?meters(clean[clean.length-1].coord,point.coord):999;if(gap>20&&gap<30000)clean.push(point);}
      if(clean.length>1)segments.push({points:clean,mode:'UNKNOWN'});
    }
  }
  let total=segments.reduce((sum,segment)=>sum+segment.points.length,0),minGap=8;
  while(total>MAX_POINTS&&minGap<4000){minGap*=2.4;segments=segments.map(segment=>({...segment,points:thin(segment.points,minGap)})).filter(segment=>segment.points.length>1);total=segments.reduce((sum,segment)=>sum+segment.points.length,0);}
  const route:RoutePoint[]=segments.flatMap((segment,index)=>segment.points.map(point=>({...point,seg:index,day:dayKey(point.time)})));
  if(!distanceKm)for(const segment of segments)for(let i=1;i<segment.points.length;i++)distanceKm+=meters(segment.points[i-1].coord,segment.points[i].coord)/1000;
  const days=daysBetween(startDate,endDate);
  let places:Place[]=[];
  if(days===1){
    const clusters:any[]=[];
    for(const visit of visits.sort((a,b)=>a.start-b.start)){const match=clusters.find(p=>meters(p.coord,visit.coord)<210);if(match){match.end=Math.max(match.end,visit.end);if(visit.semantic==='INFERRED_HOME')match.semantic=visit.semantic;}else clusters.push({...visit});}
    let stop=1;places=clusters.map(place=>{const home=place.semantic==='INFERRED_HOME';return{coord:place.coord,label:home?'home':`stop ${stop++}`,time:home?place.end:place.start};});
  }
  const dayRanges:[number,number][]=[];
  for(let i=0;i<route.length;i++){const previous=dayRanges[dayRanges.length-1];if(previous&&route[previous[0]].day===route[i].day)previous[1]=i;else dayRanges.push([i,i]);}
  return{date:startDate,endDate,days,route,segments,places,distanceKm,dayRanges};
}

function hull(points:Coordinate[]):Coordinate[]{if(points.length<3)return points;const s=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cross=(o:Coordinate,a:Coordinate,b:Coordinate)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo:Coordinate[]=[],up:Coordinate[]=[];for(const p of s){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}for(const p of [...s].reverse()){while(up.length>=2&&cross(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}const out=[...lo.slice(0,-1),...up.slice(0,-1)];return out.length?[...out,out[0]]:points;}

function episodeBoundary(points:Coordinate[]):Coordinate[]{
  if(!points.length)return[];
  const step=Math.max(1,Math.ceil(points.length/HULL_SAMPLE));
  const sampled=points.filter((_,index)=>index%step===0);
  const expanded:Coordinate[]=[];
  for(const point of sampled){
    const lonScale=Math.max(.2,Math.cos(point[1]*Math.PI/180));
    for(let i=0;i<16;i++){const angle=i/16*Math.PI*2;expanded.push([point[0]+Math.cos(angle)*.0048/lonScale,point[1]+Math.sin(angle)*.0048]);}
  }
  return hull(expanded);
}

function lineFeatures(segments:Segment[]){
  return{type:'FeatureCollection',features:segments.filter(segment=>segment.points.length>1).map(segment=>({type:'Feature',properties:{mode:segment.mode},geometry:{type:'LineString',coordinates:segment.points.map(point=>point.coord)}}))};
}

function autoDuration(recordedDays:number){return Math.min(360000,Math.max(18000,18000*Math.sqrt(Math.max(1,recordedDays))));}
function durationLabel(ms:number){const seconds=Math.round(ms/1000);if(seconds<90)return `${seconds} s`;const minutes=seconds/60;return `${Number.isInteger(minutes)?minutes:minutes.toFixed(1)} min`;}

function positionAt(story:Story,progress:number){
  const route=story.route;
  if(!route.length)return{index:0,fraction:0,day:0};
  const ranges=story.dayRanges.length?story.dayRanges:[[0,route.length-1] as [number,number]];
  const walk=Math.min(ranges.length,progress*ranges.length);
  const day=Math.min(ranges.length-1,Math.floor(walk));
  const within=Math.min(1,walk-day);
  const [first,final]=ranges[day];
  const exact=first+within*(final-first);
  const index=Math.min(route.length-1,Math.floor(exact));
  return{index,fraction:exact-index,day};
}

function activeState(story:Story,progress:number){
  const route=story.route;
  const empty={type:'FeatureCollection',features:[] as any[]};
  if(!route.length)return{features:empty,head:null as Coordinate|null,day:0};
  const last=route.length-1;
  const{index,fraction,day}=positionAt(story,progress);
  const span=Math.max(4,Math.round(route.length*TRAIL_FRACTION));
  let tail=Math.max(0,index-span+1);
  const headDay=route[index].day;
  while(tail<index&&route[tail].day!==headDay)tail++;
  const reach=Math.max(1,index-tail);
  const nodes:{coord:Coordinate;seg:number;band:number}[]=[];
  for(let i=tail;i<=index;i++)nodes.push({coord:route[i].coord,seg:route[i].seg,band:Math.min(TRAIL_BANDS-1,Math.floor((i-tail)/reach*TRAIL_BANDS))});
  let head=route[index].coord;
  if(index<last){const a=route[index],b=route[index+1];if(a.seg===b.seg){head=[a.coord[0]+(b.coord[0]-a.coord[0])*fraction,a.coord[1]+(b.coord[1]-a.coord[1])*fraction];nodes.push({coord:head,seg:a.seg,band:TRAIL_BANDS-1});}}
  const features:any[]=[];
  let current:Coordinate[]=[],band=0,seg=0,flushedSeg=-1;
  const flush=()=>{if(current.length>1){features.push({type:'Feature',properties:{t:(band+.5)/TRAIL_BANDS},geometry:{type:'LineString',coordinates:current}});flushedSeg=seg;}};
  for(const node of nodes){
    if(!current.length){current=[node.coord];band=node.band;seg=node.seg;continue;}
    if(node.seg!==seg){flush();current=[node.coord];band=node.band;seg=node.seg;continue;}
    if(node.band!==band){current.push(node.coord);flush();current=[node.coord];band=node.band;continue;}
    current.push(node.coord);
  }
  if(current.length>1)flush();
  else if(current.length===1&&features.length&&seg===flushedSeg)features[features.length-1].properties.t=1;
  return{features:{type:'FeatureCollection',features},head,day};
}

function softenBaseMap(map:any){
  for(const layer of map.getStyle().layers??[]){
    const id=String(layer.id).toLowerCase(),source=String(layer['source-layer']??'').toLowerCase(),name=`${id} ${source}`;
    try{
      if(layer.type==='background'){map.setPaintProperty(layer.id,'background-color','#f7f2e8');continue;}
      if(layer.type==='symbol'){map.setLayoutProperty(layer.id,'visibility','none');continue;}
      if(layer.type==='fill'){
        if(/water/.test(name)){map.setPaintProperty(layer.id,'fill-color','#dce8e2');map.setPaintProperty(layer.id,'fill-opacity',.72);}
        else if(/park|grass|wood|landcover|landuse/.test(name)){map.setPaintProperty(layer.id,'fill-color','#bfd0b3');map.setPaintProperty(layer.id,'fill-opacity',/residential|commercial|industrial/.test(name)?.18:.62);}
        else if(/building/.test(name)){map.setPaintProperty(layer.id,'fill-color','#d2cec5');map.setPaintProperty(layer.id,'fill-opacity',.34);}
        else{map.setPaintProperty(layer.id,'fill-color','#eee9df');map.setPaintProperty(layer.id,'fill-opacity',.3);}
        continue;
      }
      if(layer.type==='fill-extrusion'){map.setPaintProperty(layer.id,'fill-extrusion-color','#d2cec5');map.setPaintProperty(layer.id,'fill-extrusion-opacity',.18);continue;}
      if(layer.type==='line'){
        if(/water/.test(name)){map.setPaintProperty(layer.id,'line-color','#bdd1cb');map.setPaintProperty(layer.id,'line-opacity',.58);}
        else if(/rail/.test(name)){map.setPaintProperty(layer.id,'line-color','#aaa69e');map.setPaintProperty(layer.id,'line-opacity',.22);}
        else if(/highway|road|transportation|street|path/.test(name)){
          const major=/motorway|trunk|primary|major/.test(name);
          map.setPaintProperty(layer.id,'line-color',major?'#aaa59c':'#c5c0b7');
          map.setPaintProperty(layer.id,'line-opacity',major?.4:.28);
          map.setPaintProperty(layer.id,'line-width',['interpolate',['linear'],['zoom'],8,major?.35:.15,12,major?.7:.35,15,major?1.65:.8,18,major?3.2:1.65]);
        }else{map.setPaintProperty(layer.id,'line-color','#c7c1b6');map.setPaintProperty(layer.id,'line-opacity',.26);}
      }
    }catch{}
  }
}

function MapStage({story,progress,playing,follow,showPath,zoomOut,onReady}:{story:Story;progress:number;playing:boolean;follow:boolean;showPath:boolean;zoomOut:number;onReady:()=>void}){
  const container=useRef<HTMLDivElement>(null),mapRef=useRef<any>(null),markers=useRef<any[]>([]),[ready,setReady]=useState(false),lastFollow=useRef(0),lastDay=useRef(-1);
  useEffect(()=>{const load=()=>{if(!container.current||mapRef.current||!(window as any).maplibregl)return;const map=new (window as any).maplibregl.Map({container:container.current,style:'https://tiles.openfreemap.org/styles/positron',center:story.route[0]?.coord??[0,20],zoom:story.route.length?12:1.5,bearing:0,attributionControl:false});map.addControl(new (window as any).maplibregl.NavigationControl({showCompass:false}),'bottom-right');map.on('load',()=>{
      softenBaseMap(map);
      const empty={type:'FeatureCollection',features:[]};
      map.addSource('day-path',{type:'geojson',data:empty});map.addLayer({id:'path-halo',type:'line',source:'day-path',paint:{'line-color':'#f7f2e8','line-width':10,'line-opacity':.78},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:'path-all',type:'line',source:'day-path',paint:{'line-color':'#e87959','line-width':5.5,'line-opacity':.9},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:'path-walk',type:'line',source:'day-path',filter:['==',['get','mode'],'WALKING'],paint:{'line-color':'#718b68','line-width':3.4,'line-dasharray':[.45,1.8],'line-opacity':.94},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:'path-arrows',type:'symbol',source:'day-path',filter:['!=',['get','mode'],'WALKING'],layout:{'symbol-placement':'line','symbol-spacing':190,'text-field':'➤','text-size':17,'text-rotation-alignment':'map','text-keep-upright':false,'text-allow-overlap':true},paint:{'text-color':'#e87959','text-halo-color':'#f7f2e8','text-halo-width':1.5}});
      map.addSource('active-path',{type:'geojson',data:empty});map.addLayer({id:'active-halo',type:'line',source:'active-path',paint:{'line-color':['interpolate',['linear'],['get','t'],0,'rgba(247,242,232,0)',1,'rgba(247,242,232,0.86)'],'line-width':['interpolate',['linear'],['get','t'],0,3,1,10]},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:'active-line',type:'line',source:'active-path',paint:{'line-color':['interpolate',['linear'],['get','t'],0,'rgba(232,121,89,0)',.4,'rgba(232,121,89,0.6)',1,'rgba(232,121,89,1)'],'line-width':['interpolate',['linear'],['get','t'],0,1.4,1,6]},layout:{'line-cap':'round','line-join':'round'}});
      map.addSource('full-path',{type:'geojson',data:empty});map.addLayer({id:'full-halo',type:'line',source:'full-path',paint:{'line-color':'#f7f2e8','line-width':10,'line-opacity':.8},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:'full-line',type:'line',source:'full-path',paint:{'line-color':'#e87959','line-width':5.5,'line-opacity':.88},layout:{'line-cap':'round','line-join':'round'}});
      map.addSource('boundary',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});map.addLayer({id:'boundary-fill',type:'fill',source:'boundary',paint:{'fill-color':'#91a883','fill-opacity':.045}});map.addLayer({id:'boundary-line',type:'line',source:'boundary',paint:{'line-color':'#5b564e','line-width':2,'line-dasharray':[3,3],'line-opacity':.72}});map.moveLayer('boundary-fill','path-halo');
      map.addSource('head',{type:'geojson',data:empty});map.addLayer({id:'head-glow',type:'circle',source:'head',paint:{'circle-radius':16,'circle-color':'#f2c6ba','circle-opacity':.35}});map.addLayer({id:'head-ring',type:'circle',source:'head',paint:{'circle-radius':8,'circle-color':'#fbf7ef','circle-stroke-width':3,'circle-stroke-color':'#e58a6f'}});map.addLayer({id:'head-dot',type:'circle',source:'head',paint:{'circle-radius':2.5,'circle-color':'#e58a6f'}});
      mapRef.current=map;setReady(true);onReady();});};
    if((window as any).maplibregl)load();else{if(!document.querySelector('link[data-maplibre]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css';l.dataset.maplibre='true';document.head.appendChild(l);}const current=document.querySelector('script[data-maplibre]') as HTMLScriptElement|null;if(current)current.addEventListener('load',load,{once:true});else{const s=document.createElement('script');s.src='https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js';s.dataset.maplibre='true';s.onload=load;document.head.appendChild(s);}}
    return()=>{markers.current.forEach(m=>m.remove());mapRef.current?.remove();mapRef.current=null;};},[]);
  useEffect(()=>{const map=mapRef.current;if(!ready||!map)return;const features=lineFeatures(story.segments);map.getSource('day-path')?.setData(features);map.getSource('full-path')?.setData(features);map.getSource('boundary')?.setData({type:'Feature',geometry:{type:'Polygon',coordinates:[episodeBoundary([...story.route.map(p=>p.coord),...story.places.map(p=>p.coord)])]}});lastDay.current=-1;markers.current.forEach(m=>m.remove());markers.current=[];for(const place of story.places){const el=document.createElement('div');el.className='place-label';const dot=document.createElement('i');const text=document.createElement('span');text.textContent=`${place.label} · ${clock(place.time)}`;el.append(dot,text);markers.current.push(new (window as any).maplibregl.Marker({element:el,anchor:'left'}).setLngLat(place.coord).addTo(map));}if(story.route.length){const bounds=new (window as any).maplibregl.LngLatBounds();story.route.forEach(p=>bounds.extend(p.coord));map.fitBounds(bounds,{padding:{top:130+zoomOut*22,bottom:145+zoomOut*20,left:60+zoomOut*24,right:60+zoomOut*24},bearing:0,duration:700});}},[story,ready,zoomOut]);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map||!story.route.length)return;
    const{features,head,day}=activeState(story,progress);
    map.getSource('active-path')?.setData(features);
    map.getSource('head')?.setData({type:'FeatureCollection',features:head?[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:head}}]:[]});
    if(!head||!follow||!playing)return;
    if(story.dayRanges.length>1){
      if(day===lastDay.current)return;
      lastDay.current=day;
      const[first,final]=story.dayRanges[day];
      const bounds=new (window as any).maplibregl.LngLatBounds();
      for(let i=first;i<=final;i++)bounds.extend(story.route[i].coord);
      map.fitBounds(bounds,{padding:{top:130+zoomOut*22,bottom:145+zoomOut*20,left:60+zoomOut*24,right:60+zoomOut*24},maxZoom:15,bearing:0,duration:700});
      return;
    }
    if(performance.now()-lastFollow.current>220){lastFollow.current=performance.now();map.easeTo({center:head,bearing:0,duration:260});}
  },[progress,story,ready,follow,playing,zoomOut]);
  useEffect(()=>{const map=mapRef.current;if(!ready||!map)return;for(const id of ['path-halo','path-all','path-walk','path-arrows','full-halo','full-line','boundary-fill','boundary-line'])map.setLayoutProperty(id,'visibility',showPath?'visible':'none');},[showPath,ready]);
  return <div ref={container} className="map-stage"/>;
}

export default function Home(){
  const [timeline,setTimeline]=useState<any>(null),[fileName,setFileName]=useState('no timeline loaded'),[dates,setDates]=useState<string[]>([]),[mode,setMode]=useState<'day'|'range'>('day'),[date,setDate]=useState(''),[startDate,setStartDate]=useState(''),[endDate,setEndDate]=useState(''),[from,setFrom]=useState('00:00'),[to,setTo]=useState('23:59'),[progress,setProgress]=useState(0),[playing,setPlaying]=useState(false),[length,setLength]=useState<'auto'|number>('auto'),[follow,setFollow]=useState(true),[showPath,setShowPath]=useState(true),[zoomOut,setZoomOut]=useState(2),[clean,setClean]=useState(false),[mapReady,setMapReady]=useState(false),[status,setStatus]=useState('Import your Timeline.json to begin');
  const raf=useRef<number|null>(null),progressRef=useRef(0),runMsRef=useRef(18000);
  const story=useMemo(()=>{
    if(!timeline)return emptyStory;
    if(mode==='day')return date?storyFromTimeline(timeline,date,date,from,to):emptyStory;
    return startDate&&endDate?storyFromTimeline(timeline,startDate,endDate,'00:00','23:59'):emptyStory;
  },[timeline,mode,date,from,to,startDate,endDate]);
  useEffect(()=>{setProgress(0);progressRef.current=0;setPlaying(false);},[story]);useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setClean(false)};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[]);
  const importFile=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;setStatus('Reading your Timeline…');try{const data=JSON.parse(await file.text()),segments=Array.isArray(data)?data:data?.semanticSegments??[],found=[...new Set<string>(segments.map((s:any)=>String(s?.startTime??'').slice(0,10)).filter((v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)))].sort().reverse();if(!found.length)throw new Error('No dated Timeline entries found');setTimeline(data);setDates(found);setFileName(file.name);setDate(found[0]);setEndDate(found[0]);setStartDate(found[Math.min(found.length-1,29)]);setStatus(`${found.length.toLocaleString()} days ready · choose a day or a range and press play`);}catch(err){setStatus(err instanceof Error?err.message:'Could not read Timeline.json');}};
  const pickStart=(value:string)=>{setStartDate(value);if(value>endDate)setEndDate(value);};
  const pickEnd=(value:string)=>{setEndDate(value);if(value<startDate)setStartDate(value);};
  const togglePlay=()=>{if(playing){if(raf.current)cancelAnimationFrame(raf.current);setPlaying(false);return;}if(progressRef.current>=.999){progressRef.current=0;setProgress(0);}setPlaying(true);let last=performance.now();const step=(now:number)=>{const next=Math.min(1,progressRef.current+(now-last)/runMsRef.current);last=now;progressRef.current=next;setProgress(next);if(next<1)raf.current=requestAnimationFrame(step);else setPlaying(false);};raf.current=requestAnimationFrame(step);};
  const scrub=(value:number)=>{if(raf.current)cancelAnimationFrame(raf.current);setPlaying(false);progressRef.current=value;setProgress(value);};
  const recordedDays=story.dayRanges.length||1;
  const runMs=length==='auto'?autoDuration(recordedDays):length;runMsRef.current=runMs;
  const pace=recordedDays/(runMs/1000);
  const current=story.route.length?story.route[positionAt(story,progress).index]:null;
  const ranged=mode==='range'&&story.days>1;
  return <main className={`map-app ${clean?'clean':''}`}>
    <MapStage story={story} progress={progress} playing={playing} follow={follow} showPath={showPath} zoomOut={zoomOut} onReady={()=>setMapReady(true)}/>
    <header className="floating top-controls"><div className="brand"><span>↗</span><div><strong>little paths</strong><small>{fileName}</small></div></div>
      <div className="journey-pickers">
        <div className="mode-group">{(['day','range'] as const).map(value=><button key={value} className={mode===value?'active':''} onClick={()=>setMode(value)}>{value==='day'?'Day':'Range'}</button>)}</div>
        {mode==='day'?<>
          <label><span>Day</span><select value={date} onChange={e=>setDate(e.target.value)} disabled={!dates.length}>{dates.length?dates.map(d=><option key={d}>{d}</option>):<option value="">no file</option>}</select></label>
          <label><span>From</span><input type="time" value={from} onChange={e=>setFrom(e.target.value)}/></label>
          <label><span>To</span><input type="time" value={to} onChange={e=>setTo(e.target.value)}/></label>
        </>:<>
          <label><span>Start</span><select value={startDate} onChange={e=>pickStart(e.target.value)} disabled={!dates.length}>{dates.length?dates.map(d=><option key={d}>{d}</option>):<option value="">no file</option>}</select></label>
          <label><span>End</span><select value={endDate} onChange={e=>pickEnd(e.target.value)} disabled={!dates.length}>{dates.length?dates.map(d=><option key={d}>{d}</option>):<option value="">no file</option>}</select></label>
          <label className="span-readout"><span>Span</span><em>{story.days} days</em></label>
        </>}
      </div>
      <label className="import-button"><input type="file" accept=".json,application/json" onChange={importFile}/>＋ Import Timeline</label></header>
    {!story.route.length&&<div className="empty-state">{timeline?<><strong>No movement found</strong><span>Try another day or widen the range.</span></>:<><strong>Nothing loaded yet</strong><span>Import your Timeline.json to begin. It is read in your browser and never uploaded.</span></>}</div>}
    <section className="floating playback"><button className="play" onClick={togglePlay} disabled={!mapReady||!story.route.length}>{playing?'Ⅱ':'▶'}</button><div className="scrubber"><div className="time-row"><time>{current?(ranged?`${dayKey(current.time)} · ${clock(current.time)}`:clock(current.time)):'—'}</time><span>{Math.round(progress*100)}%</span></div><input type="range" min="0" max="1" step="0.001" value={progress} onChange={e=>scrub(Number(e.target.value))}/></div><div className="length"><div className="speed-group">{([['auto','Auto'],[15000,'15s'],[60000,'1m'],[180000,'3m'],[360000,'6m']] as [('auto'|number),string][]).map(([value,label])=><button key={label} className={length===value?'active':''} onClick={()=>setLength(value)}>{label}</button>)}</div><span>{durationLabel(runMs)}{recordedDays>1?` · ${pace<10?pace.toFixed(1):Math.round(pace)} days/s`:''}</span></div><label className="toggle"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/><span>Follow</span></label><label className="toggle"><input type="checkbox" checked={showPath} onChange={e=>setShowPath(e.target.checked)}/><span>Full path</span></label><label className="zoom"><span>Zoom out</span><input type="range" min="0" max="5" value={zoomOut} onChange={e=>setZoomOut(Number(e.target.value))}/></label><button className="clean-button" onClick={()=>setClean(true)}>Clean view ↗</button></section>
    <footer className="map-legend"><span><i className="legend-ride"/>ride</span><span><i className="legend-walk"/>wander</span>{!ranged&&<span><i className="legend-place"/>places</span>}<span><i className="legend-world"/>{ranged?'this stretch’s little world':'this day’s little world'}</span><small>your Timeline · real map · © OpenStreetMap contributors / OpenFreeMap</small></footer>
    <div className="status">{status}</div>{clean&&<button className="exit-clean" onClick={()=>setClean(false)}>Exit clean view · Esc</button>}
  </main>;
}
