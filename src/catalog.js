// The choices the form offers. Location strings are what Qloo's locality resolver accepts; the
// visitor markets are cities, so an "audience" is always an aggregate place, never a person.

export const CITIES=[
  {id:'hanoi',label:'Hanoi',query:'Hanoi',address:['hanoi']},
  {id:'hcmc',label:'Ho Chi Minh City',query:'Ho Chi Minh City',address:['hochiminh','saigon']},
  {id:'danang',label:'Da Nang',query:'Da Nang',address:['danang']},
  {id:'hoian',label:'Hoi An',query:'Hoi An',address:['hoian']},
  {id:'dalat',label:'Da Lat',query:'Da Lat, Vietnam',address:['dalat']},
  {id:'nhatrang',label:'Nha Trang',query:'Nha Trang',address:['nhatrang']},
  {id:'hue',label:'Hue',query:'Hue, Vietnam',address:['hue']},
  {id:'phuquoc',label:'Phu Quoc',query:'Phu Quoc',address:['phuquoc']}
];

export const MARKETS=[
  {id:'seoul',label:'Seoul',country:'South Korea',query:'Seoul'},
  {id:'busan',label:'Busan',country:'South Korea',query:'Busan'},
  {id:'tokyo',label:'Tokyo',country:'Japan',query:'Tokyo'},
  {id:'osaka',label:'Osaka',country:'Japan',query:'Osaka'},
  {id:'taipei',label:'Taipei',country:'Taiwan',query:'Taipei'},
  {id:'singapore',label:'Singapore',country:'Singapore',query:'Singapore'},
  {id:'bangkok',label:'Bangkok',country:'Thailand',query:'Bangkok'},
  {id:'sydney',label:'Sydney',country:'Australia',query:'Sydney'},
  {id:'melbourne',label:'Melbourne',country:'Australia',query:'Melbourne'},
  {id:'london',label:'London',country:'United Kingdom',query:'London'},
  {id:'paris',label:'Paris',country:'France',query:'Paris'},
  {id:'berlin',label:'Berlin',country:'Germany',query:'Berlin'},
  {id:'newyork',label:'New York',country:'United States',query:'New York'},
  {id:'losangeles',label:'Los Angeles',country:'United States',query:'Los Angeles'}
];

// Each business type maps to the Qloo place tags its peers carry (any of them), so "where they
// already go" compares like with like.
export const BUSINESSES=[
  {id:'cafe',label:'Cafe',tags:['urn:tag:genre:place:restaurant:coffee_shop','urn:tag:genre:place:cafe','urn:tag:category:place:coffee_shop','urn:tag:offerings:place:coffee']},
  {id:'restaurant',label:'Restaurant',tags:['urn:tag:genre:place:restaurant']},
  {id:'bar',label:'Bar',tags:['urn:tag:genre:place:restaurant:bar','urn:tag:genre:place:bar','urn:tag:category:place:bar']},
  {id:'stay',label:'Homestay / hotel',tags:['urn:tag:genre:place:hotel','urn:tag:genre:place:hotel:hostel']},
  {id:'spa',label:'Spa',tags:['urn:tag:genre:place:spa','urn:tag:genre:place:spa_and_health_club']},
  {id:'tour',label:'Tour / experience',tags:['urn:tag:genre:place:tourist_attraction','urn:tag:genre:place:tour_operator']}
];

export const CULTURE_TYPES={
  artist:{label:'Music',type:'urn:entity:artist'},
  movie:{label:'Film',type:'urn:entity:movie'},
  tv_show:{label:'TV',type:'urn:entity:tv_show'},
  book:{label:'Books',type:'urn:entity:book'},
  podcast:{label:'Podcasts',type:'urn:entity:podcast'},
  brand:{label:'Brands',type:'urn:entity:brand'},
  video_game:{label:'Games',type:'urn:entity:video_game'},
  place:{label:'Places',type:'urn:entity:place'},
  destination:{label:'Destinations',type:'urn:entity:destination'}
};

function pick(list,id,what) {
  const found=list.find((item)=>item.id===id || item.label.toLowerCase()===String(id ?? '').toLowerCase());
  if (!found) throw new Error(`unknown ${what} "${id}"; choose one of: ${list.map((i)=>i.id).join(', ')}`);
  return found;
}

export const cityOf=(id)=>pick(CITIES,id,'city');
export const marketOf=(id)=>pick(MARKETS,id,'market');
export const businessOf=(id)=>pick(BUSINESSES,id,'business type');
