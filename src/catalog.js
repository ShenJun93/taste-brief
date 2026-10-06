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

// Each business type maps to the Qloo place tags its peers carry (any of them), and to the
// primary genres that count as a peer. Tags alone are too loose (a resort carries "Bar", a pho
// shop carries "Coffee"), so peers are confirmed by the place's primary genre.
export const BUSINESSES=[
  {id:'cafe',label:'Cafe',plural:'cafés',
    tags:['urn:tag:genre:place:restaurant:coffee_shop','urn:tag:genre:place:cafe','urn:tag:category:place:coffee_shop'],
    genre:/^(restaurant:)?(coffee_shop|cafe|coffee_roasters|tea_house|tea_room|dessert_shop|juice_shop|bubble_tea|chocolate_cafe)/},
  {id:'restaurant',label:'Restaurant',plural:'restaurants',
    tags:['urn:tag:genre:place:restaurant'],
    genre:/^restaurant(?!:(coffee_shop|cafe|bar|pub|live_music_bar|sports_bar|wine_bar|cocktail_bar|pastry_shop|bakery|dessert_shop))/},
  {id:'bar',label:'Bar',plural:'bars',
    tags:['urn:tag:genre:place:restaurant:bar','urn:tag:genre:place:bar','urn:tag:category:place:bar'],
    genre:/^(night_club|bar|pub|lounge|brewpub|restaurant:(bar|pub|live_music_bar|sports_bar|wine_bar|cocktail_bar|beer_hall|brewpub|lounge))/},
  {id:'stay',label:'Homestay / hotel',plural:'places to stay',
    tags:['urn:tag:genre:place:hotel','urn:tag:genre:place:hotel:hostel'],
    genre:/^(hotel|hostel|resort|guest_house|homestay|inn|motel|villa|lodging|bed_and_breakfast)/},
  {id:'spa',label:'Spa',plural:'spas',
    tags:['urn:tag:genre:place:spa','urn:tag:genre:place:spa_and_health_club'],
    genre:/^(spa|massage|day_spa|wellness|hotel:spa)/},
  {id:'tour',label:'Tour / experience',plural:'attractions and tours',
    tags:['urn:tag:genre:place:tourist_attraction','urn:tag:genre:place:tour_operator'],
    genre:/^(tourist_attraction|tour_operator|tour_agency|museum|park|landmark|historical|temple|pagoda|market|art_gallery|beach|garden)/}
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
