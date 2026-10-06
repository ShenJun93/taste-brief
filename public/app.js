// Page logic. Every string from Qloo or the model is inserted as text, never as HTML; only the
// fixed interface strings below (written here) are inserted as HTML.

const T={
  en:{
    'nav.how':'How it works','nav.code':'Code',
    'hero.title':'Know what your visitors love before they walk in.',
    'hero.lede':'For cafés, homestays and tours in Vietnam. Pick the visitors you want — people from Seoul, Tokyo, Sydney — and get a one-page plan built from <strong>Qloo\'s taste graph</strong>: where they already go in your city, what those places have in common, music both sides know, and how your own ideas measure up. Every claim links to the Qloo result behind it.',
    'hero.example':'See an example: Hanoi café, guests from Seoul','hero.build':'Build one for your place ↓',
    'progress.title':'Agent at work',
    'tools.copy':'Copy plan','tools.share':'Copy share link','tools.print':'Print','tools.copied':'Copied.','tools.copyFail':'Could not copy; select the text instead.',
    'actions.title':'Do this next','dropped':(n)=>`${n} unsupported action${n>1?'s':''} removed`,
    'profile.title':'What their favourites have in common','ideas.title':'Your ideas, measured','music.title':'Music both sides know',
    'contrast.title':'Same question, no Qloo','contrast.note':'We asked the same model the same question with no data, then looked each of its picks up in Qloo.',
    'contrast.places':'Places it suggested','contrast.artists':'Artists it suggested','contrast.advice':'Its advice',
    'caveats.title':'What this does not tell you','ledger.title':'Evidence ledger — every cited fact and the Qloo request behind it','trace.title':'Agent trace',
    'form.title':'Build a brief for your place','form.business':'I run a','form.city':'in','form.market':'and want more guests from',
    'form.own':'My place\'s name','form.ownHint':'optional — we look it up in Qloo','form.ideas':'Ideas I\'m considering','form.ideasHint':'one per line, up to 6',
    'form.go':'Build my brief','form.goHint':'Takes about 30–60 seconds; you can watch the agent work.','form.samples':'Or open a finished example:',
    'form.defaultIdeas':'egg coffee workshop\nK-pop playlist\nlive music on Fridays',
    'how.title':'How it works',
    'how.1':'<strong>Qloo first.</strong> The server asks Qloo for places in your city ranked by the taste of people living in the visitor city, and the same lists without that signal. The difference is what that market adds.',
    'how.2':'<strong>What sets their favourites apart.</strong> Tags (ambience, setting, offerings) clearly more common among the market\'s favourites than among the city\'s top places.',
    'how.3':'<strong>An agent maps your ideas.</strong> NVIDIA Nemotron calls Qloo tools to find the tag for each idea, then scores it against the same lists — places, music or TV. It can only use tag ids Qloo returned.',
    'how.4':'<strong>A plan that cites its evidence.</strong> The model writes from a fact sheet; actions without a valid citation, actions that push an idea the data does not support, and names that are not in the data are removed. Names and numbers on the page come from Qloo results.',
    'how.5':'<strong>Also an MCP server.</strong> The same tools are served at <code>/mcp</code> for any agent to call.',
    'how.note':'Qloo results describe the aggregate taste of people in a city. They say nothing about any individual guest, and no personal data is sent to Qloo.',
    'foot':'Data: Qloo Taste AI™ · Model: NVIDIA Nemotron on Nebius · Map: © OpenStreetMap contributors · Built for the Qloo Agentic Hackathon',
    eyebrow:(i)=>`${i.business} in ${i.city} · guests from ${i.market}, ${i.country}`,
    writtenBy:(e)=>`Written by ${e}`,facts:(n)=>`${n} facts cited`,saved:(d)=>`Saved example from ${d}`,generated:(d)=>`Generated ${d}`,
    mapTitle:(i)=>`Where people from ${i.market} already go in ${i.city}`,
    mapNote:(i)=>`Darker pins are ${i.businessPlural}; lighter pins are other places they favour. Click a pin for its rank.`,
    peersTitle:(i)=>`${cap(i.businessPlural)} they favour`,
    peersNote:(i,n,c)=>n?`${n} ${i.businessPlural} in ${i.city} have a measurable ${i.market} signal in Qloo. Ranked by the taste of people in ${i.market}; the badge compares with ${i.city}'s top ${c} ${i.businessPlural}.`:`Qloo shows no ${i.businessPlural} in ${i.city} with a measurable ${i.market} signal yet. The lists below cover every kind of place.`,
    allTitle:()=>'All kinds of places they favour',
    allNote:(i,n)=>`Hotels, restaurants and attractions in ${i.city} ranked for people in ${i.market} (${n} with a signal). Places marked ★ are suggested partners.`,
    notTop:'not in city top list',up:(n,c)=>`▲ ${n} vs city #${c}`,city:(c)=>`city #${c}`,partner:'★ Partner idea',
    profileNote:(i)=>`Tags clearly more common among the places people in ${i.market} favour than among ${i.city}'s top 50 places.`,
    profileNone:'No tag stands out clearly enough to report for this market and city.',
    legendMarket:(i)=>`${i.market} favourites`,legendCity:(i)=>`${i.city} overall`,
    ratio:(r)=>r===Infinity?'only theirs':`${r.toFixed(1)}×`,
    audience:(i,s)=>`Audience of these places (Qloo demographics, all visitors): ${s}.`,
    ideasNote:'Each idea is mapped to a Qloo tag and counted among the market\'s favourites and the city\'s top list.',
    ideaCounts:(x,i)=>`${x.marketCount}/${x.marketTotal} ${i.market} favourites vs ${x.cityCount}/${x.cityTotal} city-wide · tag “${x.via.name}” (${x.domain})`,
    unmapped:'No matching Qloo tag found',notEvaluated:'Not evaluated (no model configured)',
    entityRank:(x)=>`${x.via.kind.replace('_',' ')} “${x.via.name}”: ${x.status==='ranked'?`rank ${x.rank} of ${x.of}`:'no market signal'}`,
    ownNotFound:(o,i)=>`“${o.query}” was not found in Qloo for ${i.city}.`,
    ownNoSignal:(o,i)=>` is in Qloo, but shows no measurable ${i.market} affinity next to the favourites.`,
    ownRank:(o,i)=>` ranks ${o.tied?'joint ':''}${o.rank} of ${o.of} when Qloo ranks it with the top ${i.market} favourites.`,
    musicNote:(i)=>`Artists loved by people in ${i.market} that people in ${i.city} also love — a playlist guests and locals both know.`,
    musicEmpty:(i)=>`No artist is in both ${i.market}'s and ${i.city}'s top lists, so there is no shared playlist; the artists below are distinctive to ${i.market}.`,
    distinct:(i)=>`Loved in ${i.market}, not in ${i.city}'s top list`,tvBridge:'TV both sides watch',
    pickSignal:(p,i)=>`In Qloo with a ${i.market} signal${p.peerRank?` · their #${p.peerRank} among ${i.businessPlural}`:''}`,
    pickNoSignal:(p,i)=>`In Qloo${p.qlooName&&p.qlooName!==p.name?` as “${p.qlooName}”`:''}, but no measurable ${i.market} signal`,
    pickMissing:'Not found in Qloo for this city',
    artistHit:(a,i)=>`Qloo ${i.market} #${a.qlooRank}${a.localRank?` · ${i.city} #${a.localRank}`:''}`,
    artistMiss:(i,n)=>`Not in Qloo's top ${n} for ${i.market}`,
    caveatQloo:'Qloo results describe the aggregate taste of people in a city, not any individual guest.',
    verdict:{'over-represented':'Over-represented','common':'Common, not distinctive','too-few':'Too few to tell','untested':'Untested','under-represented':'Less common among them','absent-from-favourites':'Absent from their favourites'},
    phase:{qloo:'Qloo',agent:'Agent',model:'Model',done:'Done',cache:'Cache',start:'Start'},
    sending:'Sending your question',failed:(m)=>`Could not build the brief: ${m}`,
    rankLine:(p,i)=>`Rank ${p.tied?'=':''}${p.rank} for people in ${i.market}; ${p.cityRank?`#${p.cityRank} city-wide`:'not in the city-wide top list'}.`,
    tagLine:(x,i)=>`Carried by ${x.marketCount} of ${x.marketTotal} places people in ${i.market} favour, against ${x.baselineCount} of ${x.baselineTotal} city-wide.`,
    ideaLine:(x,i,v)=>`Idea “${x.idea}” → Qloo tag “${x.name}” (${x.domain}): ${x.marketCount}/${x.marketTotal} of their favourites vs ${x.cityCount}/${x.cityTotal} city-wide — ${v}.`,
    cultureLine:(x,i)=>`Rank ${x.rank} for people in ${i.market}${x.localRank?`, rank ${x.localRank} in ${i.city}`:''}.`,
    examples:[
      {id:'hanoi-cafe-seoul',label:'Hanoi café · guests from Seoul'},
      {id:'hoian-stay-sydney',label:'Hoi An homestay · guests from Sydney'},
      {id:'hcmc-cafe-tokyo',label:'Saigon café · guests from Tokyo'},
      {id:'danang-cafe-seoul',label:'Da Nang café · guests from Seoul'},
      {id:'hcmc-bar-seoul',label:'Saigon bar · guests from Seoul'},
      {id:'hanoi-stay-tokyo',label:'Hanoi hotel · guests from Tokyo'},
      {id:'hcmc-restaurant-singapore',label:'Saigon restaurant · guests from Singapore'}
    ]
  },
  vi:{
    'nav.how':'Cách hoạt động','nav.code':'Mã nguồn',
    'hero.title':'Biết khách của bạn thích gì trước khi họ bước vào.',
    'hero.lede':'Dành cho quán cà phê, homestay và tour ở Việt Nam. Chọn nhóm khách bạn muốn — người từ Seoul, Tokyo, Sydney — và nhận một bản kế hoạch một trang dựa trên <strong>dữ liệu gu thưởng thức của Qloo</strong>: họ đang đến đâu trong thành phố của bạn, những nơi đó giống nhau ở điểm gì, nhạc mà cả khách lẫn người Việt cùng nghe, và ý tưởng của bạn được dữ liệu đánh giá ra sao. Mỗi nhận định đều dẫn tới kết quả Qloo đứng sau.',
    'hero.example':'Xem ví dụ: quán cà phê Hà Nội, khách Seoul','hero.build':'Làm cho quán của bạn ↓',
    'progress.title':'Agent đang làm việc',
    'tools.copy':'Sao chép kế hoạch','tools.share':'Sao chép link chia sẻ','tools.print':'In','tools.copied':'Đã sao chép.','tools.copyFail':'Không sao chép được; hãy bôi đen để chép.',
    'actions.title':'Việc nên làm tiếp','dropped':(n)=>`Đã loại ${n} hành động không có căn cứ`,
    'profile.title':'Những nơi họ thích có điểm chung gì','ideas.title':'Ý tưởng của bạn, đo bằng dữ liệu','music.title':'Nhạc cả hai bên cùng nghe',
    'contrast.title':'Cùng câu hỏi, không có Qloo','contrast.note':'Chúng tôi hỏi cùng mô hình đó cùng câu hỏi nhưng không cho dữ liệu, rồi tra từng gợi ý của nó trên Qloo.',
    'contrast.places':'Địa điểm nó gợi ý','contrast.artists':'Nghệ sĩ nó gợi ý','contrast.advice':'Lời khuyên của nó',
    'caveats.title':'Điều dữ liệu này chưa nói được','ledger.title':'Sổ bằng chứng — mọi dữ kiện được trích và yêu cầu Qloo tương ứng','trace.title':'Nhật ký agent',
    'form.title':'Tạo bản kế hoạch cho quán của bạn','form.business':'Tôi kinh doanh','form.city':'tại','form.market':'và muốn có thêm khách từ',
    'form.own':'Tên quán của tôi','form.ownHint':'không bắt buộc — chúng tôi tra trên Qloo','form.ideas':'Ý tưởng tôi đang cân nhắc','form.ideasHint':'mỗi dòng một ý, tối đa 6',
    'form.go':'Tạo kế hoạch','form.goHint':'Mất khoảng 30–60 giây; bạn có thể xem agent làm từng bước.','form.samples':'Hoặc mở một ví dụ có sẵn:',
    'form.defaultIdeas':'workshop cà phê trứng\nplaylist K-pop\nnhạc sống tối thứ Sáu',
    'how.title':'Cách hoạt động',
    'how.1':'<strong>Qloo trước tiên.</strong> Máy chủ hỏi Qloo các địa điểm trong thành phố được xếp hạng theo gu của người sống ở thành phố của khách, và cùng danh sách đó khi không có tín hiệu này. Phần chênh lệch là điều nhóm khách đó mang lại.',
    'how.2':'<strong>Điều làm nên khác biệt.</strong> Các nhãn (không khí, bối cảnh, món phục vụ) phổ biến hơn rõ rệt ở những nơi nhóm khách thích so với top địa điểm của thành phố.',
    'how.3':'<strong>Agent chấm ý tưởng của bạn.</strong> NVIDIA Nemotron gọi công cụ Qloo để tìm nhãn cho từng ý tưởng, rồi chấm trên cùng các danh sách — địa điểm, âm nhạc hoặc phim truyền hình. Nó chỉ được dùng nhãn do Qloo trả về.',
    'how.4':'<strong>Kế hoạch có trích dẫn.</strong> Mô hình viết từ bảng dữ kiện; hành động không có trích dẫn hợp lệ, hành động đẩy một ý tưởng mà dữ liệu không ủng hộ, và tên không có trong dữ liệu đều bị loại. Tên và con số trên trang lấy từ kết quả Qloo.',
    'how.5':'<strong>Cũng là một MCP server.</strong> Các công cụ này có ở <code>/mcp</code> cho bất kỳ agent nào gọi.',
    'how.note':'Kết quả Qloo mô tả gu chung của người sống ở một thành phố, không nói gì về một vị khách cụ thể, và không có dữ liệu cá nhân nào được gửi tới Qloo.',
    'foot':'Dữ liệu: Qloo Taste AI™ · Mô hình: NVIDIA Nemotron trên Nebius · Bản đồ: © OpenStreetMap · Dự thi Qloo Agentic Hackathon',
    eyebrow:(i)=>`${BIZ_VI[i.businessId] ?? i.business} tại ${i.city} · khách từ ${i.market}`,
    writtenBy:(e)=>`Viết bởi ${e}`,facts:(n)=>`${n} dữ kiện được trích`,saved:(d)=>`Ví dụ lưu lúc ${d}`,generated:(d)=>`Tạo lúc ${d}`,
    mapTitle:(i)=>`Người từ ${i.market} đang đến đâu ở ${i.city}`,
    mapNote:(i)=>`Ghim đậm là ${BIZP_VI[i.businessId]}; ghim nhạt là những nơi khác họ thích. Bấm vào ghim để xem thứ hạng.`,
    peersTitle:(i)=>`${cap(BIZP_VI[i.businessId])} họ thích`,
    peersNote:(i,n,c)=>n?`Qloo đo được tín hiệu từ ${i.market} cho ${n} ${BIZP_VI[i.businessId]} ở ${i.city}. Xếp theo gu của người ở ${i.market}; nhãn bên phải so với top ${c} của ${i.city}.`:`Qloo chưa đo được tín hiệu từ ${i.market} cho ${BIZP_VI[i.businessId]} ở ${i.city}. Các danh sách dưới đây gồm mọi loại địa điểm.`,
    allTitle:()=>'Mọi loại địa điểm họ thích',
    allNote:(i,n)=>`Khách sạn, nhà hàng, điểm tham quan ở ${i.city} xếp theo gu của người ở ${i.market} (${n} nơi có tín hiệu). Nơi có dấu ★ là gợi ý hợp tác.`,
    notTop:'ngoài top thành phố',up:(n,c)=>`▲ ${n} so với hạng ${c} chung`,city:(c)=>`hạng ${c} chung`,partner:'★ Gợi ý hợp tác',
    profileNote:(i)=>`Các nhãn phổ biến hơn rõ rệt ở những nơi người ${i.market} thích so với top 50 địa điểm của ${i.city}.`,
    profileNone:'Không có nhãn nào nổi bật đủ rõ để báo cáo cho nhóm khách và thành phố này.',
    legendMarket:(i)=>`Nơi người ${i.market} thích`,legendCity:(i)=>`${i.city} nói chung`,
    ratio:(r)=>r===Infinity?'chỉ ở họ':`${r.toFixed(1)}×`,
    audience:(i,s)=>`Khách của những nơi này (nhân khẩu học Qloo, mọi khách): ${s}.`,
    ideasNote:'Mỗi ý tưởng được gắn với một nhãn Qloo và đếm trong danh sách nơi nhóm khách thích và top của thành phố.',
    ideaCounts:(x,i)=>`${x.marketCount}/${x.marketTotal} nơi người ${i.market} thích so với ${x.cityCount}/${x.cityTotal} chung · nhãn “${x.via.name}” (${DOMAIN_VI[x.domain] ?? x.domain})`,
    unmapped:'Không tìm thấy nhãn Qloo phù hợp',notEvaluated:'Chưa đánh giá (chưa cấu hình mô hình)',
    entityRank:(x)=>`${x.via.kind.replace('_',' ')} “${x.via.name}”: ${x.status==='ranked'?`hạng ${x.rank}/${x.of}`:'không có tín hiệu'}`,
    ownNotFound:(o,i)=>`Không tìm thấy “${o.query}” trên Qloo ở ${i.city}.`,
    ownNoSignal:(o,i)=>` có trên Qloo nhưng chưa có tín hiệu từ ${i.market} bên cạnh các nơi họ thích.`,
    ownRank:(o,i)=>` đứng ${o.tied?'đồng ':''}hạng ${o.rank}/${o.of} khi Qloo xếp cùng các nơi người ${i.market} thích nhất.`,
    musicNote:(i)=>`Nghệ sĩ được người ở ${i.market} yêu thích mà người ở ${i.city} cũng thích — playlist mà cả khách lẫn người địa phương đều biết.`,
    musicEmpty:(i)=>`Không nghệ sĩ nào có mặt ở cả top của ${i.market} lẫn ${i.city}, nên chưa có playlist chung; bên dưới là nghệ sĩ đặc trưng của ${i.market}.`,
    distinct:(i)=>`Được yêu thích ở ${i.market}, không có trong top của ${i.city}`,tvBridge:'Phim truyền hình cả hai bên cùng xem',
    pickSignal:(p,i)=>`Có trên Qloo, có tín hiệu từ ${i.market}${p.peerRank?` · hạng ${p.peerRank} trong ${BIZP_VI[i.businessId]} họ thích`:''}`,
    pickNoSignal:(p,i)=>`Có trên Qloo${p.qlooName&&p.qlooName!==p.name?` (tên “${p.qlooName}”)`:''}, nhưng không có tín hiệu từ ${i.market}`,
    pickMissing:'Không tìm thấy trên Qloo ở thành phố này',
    artistHit:(a,i)=>`Qloo: hạng ${a.qlooRank} ở ${i.market}${a.localRank?` · hạng ${a.localRank} ở ${i.city}`:''}`,
    artistMiss:(i,n)=>`Không có trong top ${n} của Qloo cho ${i.market}`,
    caveatQloo:'Kết quả Qloo mô tả gu chung của người sống ở một thành phố, không phải của một vị khách cụ thể.',
    verdict:{'over-represented':'Nổi bật ở họ','common':'Phổ biến, không tạo khác biệt','too-few':'Quá ít dữ liệu','untested':'Chưa ai làm','under-represented':'Ít gặp ở họ hơn','absent-from-favourites':'Không có ở nơi họ thích'},
    phase:{qloo:'Qloo',agent:'Agent',model:'Mô hình',done:'Xong',cache:'Bộ nhớ',start:'Bắt đầu'},
    sending:'Đang gửi câu hỏi',failed:(m)=>`Không tạo được kế hoạch: ${m}`,
    rankLine:(p,i)=>`Hạng ${p.tied?'=':''}${p.rank} với người ở ${i.market}; ${p.cityRank?`hạng ${p.cityRank} chung`:'ngoài top chung của thành phố'}.`,
    tagLine:(x,i)=>`Có ở ${x.marketCount}/${x.marketTotal} nơi người ${i.market} thích, so với ${x.baselineCount}/${x.baselineTotal} nơi chung.`,
    ideaLine:(x,i,v)=>`Ý tưởng “${x.idea}” → nhãn Qloo “${x.name}” (${DOMAIN_VI[x.domain] ?? x.domain}): ${x.marketCount}/${x.marketTotal} nơi họ thích so với ${x.cityCount}/${x.cityTotal} chung — ${v}.`,
    cultureLine:(x,i)=>`Hạng ${x.rank} với người ở ${i.market}${x.localRank?`, hạng ${x.localRank} ở ${i.city}`:''}.`,
    examples:[
      {id:'hanoi-cafe-seoul',label:'Cà phê Hà Nội · khách Seoul'},
      {id:'hoian-stay-sydney',label:'Homestay Hội An · khách Sydney'},
      {id:'hcmc-cafe-tokyo',label:'Cà phê Sài Gòn · khách Tokyo'},
      {id:'danang-cafe-seoul',label:'Cà phê Đà Nẵng · khách Seoul'},
      {id:'hcmc-bar-seoul',label:'Quán bar Sài Gòn · khách Seoul'},
      {id:'hanoi-stay-tokyo',label:'Khách sạn Hà Nội · khách Tokyo'},
      {id:'hcmc-restaurant-singapore',label:'Nhà hàng Sài Gòn · khách Singapore'}
    ]
  }
};
const BIZ_VI={cafe:'Quán cà phê',restaurant:'Nhà hàng',bar:'Quán bar',stay:'Homestay / khách sạn',spa:'Spa',tour:'Tour / trải nghiệm'};
const BIZP_VI={cafe:'quán cà phê',restaurant:'nhà hàng',bar:'quán bar',stay:'chỗ lưu trú',spa:'spa',tour:'điểm tham quan và tour'};
const DOMAIN_VI={places:'địa điểm',music:'âm nhạc',TV:'phim truyền hình'};
const cap=(s)=>String(s ?? '').charAt(0).toUpperCase()+String(s ?? '').slice(1);

const store={
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch { /* storage unavailable */ } }
};

let lang=new URLSearchParams(location.search).get('lang') ?? store.get('lang') ?? (navigator.language?.startsWith('vi')?'vi':'en');
if (!T[lang]) lang='en';
const t=(key,...args)=>{ const v=T[lang][key] ?? T.en[key]; return typeof v==='function'?v(...args):v; };

const $=(id)=>document.getElementById(id);
function h(tag,props={},...children) {
  const el=document.createElement(tag);
  for (const [k,v] of Object.entries(props)) {
    if (v===null || v===undefined || v===false) continue;
    if (k==='class') el.className=v;
    else if (k==='style') el.setAttribute('style',v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2),v);
    else el.setAttribute(k,v===true?'':v);
  }
  for (const c of children.flat()) if (c!==null && c!==undefined && c!==false) el.append(c instanceof Node?c:String(c));
  return el;
}
const fill=(id,...kids)=>$(id).replaceChildren(...kids.flat().filter((k)=>k!==null && k!==undefined && k!==false));
const pct=(n,d)=>d?Math.round(100*n/d):0;

let state={business:'cafe',brief:null,options:null,sampleId:null};
let map=null;

function applyLang() {
  document.documentElement.lang=lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent=t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML=t(el.dataset.i18nHtml);
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed',String(b.dataset.lang===lang));
  fill('samples',t('examples').map((s)=>h('button',{type:'button',class:'chip',onclick:()=>openSample(s.id)},s.label)));
  if (state.options) renderBusinessChips();
  const ideas=$('ideas');
  if (!ideas.dataset.touched) ideas.value=t('form.defaultIdeas');
}

function setLang(next) {
  lang=next;
  store.set('lang',lang);
  applyLang();
  if (state.sampleId) openSample(state.sampleId,{scroll:false});
  else if (state.brief) render(state.brief,{scroll:false});
}

function renderBusinessChips() {
  fill('business',state.options.businesses.map((b)=>h('button',{type:'button',class:'chip','aria-pressed':String(b.id===state.business),'data-id':b.id,onclick:()=>pickBusiness(b.id)},lang==='vi'?BIZ_VI[b.id]:b.label)));
}

async function init() {
  state.options=await fetch('/api/options').then((r)=>r.json());
  for (const c of state.options.cities) $('city').append(h('option',{value:c.id},c.label));
  for (const m of state.options.markets) $('market').append(h('option',{value:m.id},`${m.label}, ${m.country}`));
  $('market').value='seoul';
  $('ideas').addEventListener('input',()=>{ $('ideas').dataset.touched='1'; });
  for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click',()=>setLang(b.dataset.lang));
  $('brief-form').addEventListener('submit',onSubmit);
  $('hero-example').addEventListener('click',()=>openSample('hanoi-cafe-seoul'));
  $('copy-brief').addEventListener('click',()=>copyText(planText()));
  $('share-brief').addEventListener('click',copyShareLink);
  $('print-brief').addEventListener('click',()=>window.print());
  document.addEventListener('click',(e)=>{ if (!e.target.closest('.ref') && !e.target.closest('#pop')) $('pop').hidden=true; });
  document.addEventListener('keydown',(e)=>{ if (e.key==='Escape') $('pop').hidden=true; });
  applyLang();
  // A shared link either opens a saved example or fills the form; it never spends quota by itself.
  const q=new URLSearchParams(location.search);
  if (q.get('example')) openSample(q.get('example'));
  else if (q.get('city')) {
    if (q.get('business')) pickBusiness(q.get('business'));
    $('city').value=q.get('city');
    if (q.get('market')) $('market').value=q.get('market');
    if (q.get('own')) $('own').value=q.get('own');
    if (q.get('ideas')) { $('ideas').value=q.get('ideas'); $('ideas').dataset.touched='1'; }
    $('form-card').scrollIntoView();
  }
}

function pickBusiness(id) {
  state.business=id;
  for (const el of $('business').children) el.setAttribute('aria-pressed',String(el.dataset.id===id));
}

function resetView() {
  $('error').hidden=true;
  $('result').hidden=true;
  $('steps').replaceChildren();
}

function stepRow(e) {
  return h('li',{},
    h('span',{class:'ms'},`${(e.ms/1000).toFixed(1)}s`),
    h('span',{class:`phase ${e.phase}`},t('phase')[e.phase] ?? e.phase),
    h('span',{},e.label),
    e.detail?h('span',{class:'detail'},e.detail):null
  );
}

function showError(message) {
  $('error').hidden=false;
  $('error').textContent=message;
  $('error').scrollIntoView({block:'center'});
}

async function onSubmit(event) {
  event.preventDefault();
  resetView();
  state.sampleId=null;
  const body={
    business:state.business,
    city:$('city').value,
    market:$('market').value,
    ownPlace:$('own').value.trim(),
    ideas:$('ideas').value.split('\n').map((s)=>s.trim()).filter(Boolean).slice(0,6),
    lang
  };
  $('go').disabled=true;
  $('progress').hidden=false;
  $('progress').scrollIntoView({block:'start'});
  $('steps').append(h('li',{class:'live'},h('span',{class:'ms'},'0.0s'),h('span',{class:'phase qloo'},t('phase').start),h('span',{},t('sending'))));
  try {
    const res=await fetch('/api/brief',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if (!res.ok || !res.body) {
      const err=await res.json().catch(()=>({error:`HTTP ${res.status}`}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const reader=res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer='';
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      buffer+=value;
      let cut;
      while ((cut=buffer.indexOf('\n\n'))>=0) {
        const chunk=buffer.slice(0,cut);
        buffer=buffer.slice(cut+2);
        const event=/^event: (.+)$/m.exec(chunk)?.[1];
        const data=JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? 'null');
        if (event==='step') {
          $('steps').querySelector('.live')?.classList.remove('live');
          const row=stepRow(data);
          row.classList.add('live');
          $('steps').append(row);
        } else if (event==='brief') {
          $('steps').querySelector('.live')?.classList.remove('live');
          render(data);
        } else if (event==='error') {
          throw new Error(data.error);
        }
      }
    }
  } catch (error) {
    showError(t('failed',error.message));
  } finally {
    $('go').disabled=false;
  }
}

async function openSample(id,{scroll=true}={}) {
  resetView();
  $('progress').hidden=true;
  state.sampleId=id;
  try {
    let res=await fetch(`/api/samples/${id}${lang==='vi'?'-vi':''}`);
    if (!res.ok && lang==='vi') res=await fetch(`/api/samples/${id}`);
    if (!res.ok) throw new Error('example not found');
    const brief=await res.json();
    render(brief,{sample:true,scroll});
    const i=brief.input;
    pickBusiness(i.businessId);
    $('city').value=i.cityId;
    $('market').value=i.marketId;
    $('own').value=i.ownPlace ?? '';
    $('ideas').value=(i.ideas ?? []).join('\n');
    $('ideas').dataset.touched='1';
  } catch (error) {
    showError(error.message);
  }
}

// --- evidence chips ----------------------------------------------------------------------------

function refLabel(ref) {
  const entry=state.brief?.ledger?.[ref];
  if (!entry) return ref;
  const it=entry.item;
  if (entry.kind==='tag') return `${it.name} ${it.marketCount}/${it.marketTotal}`;
  if (entry.kind==='idea') return `${it.idea} → ${it.name}`;
  return it.name;
}

function refDetail(ref) {
  const {input}=state.brief;
  const entry=state.brief.ledger[ref];
  const it=entry.item;
  const lines=[];
  if (entry.kind==='place') {
    lines.push(it.question?`${it.question}: #${it.rank}`:t('rankLine',it,input));
    if (it.address) lines.push(it.address);
    if (it.tags?.length) lines.push(it.tags.slice(0,8).map((x)=>x.name).join(' · '));
  } else if (entry.kind==='tag') {
    lines.push(t('tagLine',it,input));
  } else if (entry.kind==='idea') {
    lines.push(t('ideaLine',it,input,t('verdict')[it.verdict] ?? it.verdict));
  } else {
    lines.push(t('cultureLine',it,input));
  }
  const src=entry.source;
  const names=(refs)=>(refs ?? []).map((r)=>state.brief.ledger[r]?.item?.name).filter(Boolean).join(', ');
  let request='';
  if (src?.params) request=`Qloo ${src.endpoint}?${Object.entries(src.params).map(([k,v])=>`${k}=${Array.isArray(v)?v.join(','):v}`).join('&')}`;
  else if (src?.rule) request=[src.rule,names(it.places),names(it.examples)].filter(Boolean).join(' — ');
  return {title:it.name ?? ref,lines,request,image:entry.kind==='place'?it.image:null};
}

function refChip(ref) {
  return h('button',{type:'button',class:'ref','aria-haspopup':'dialog',onclick:(e)=>showPop(e.currentTarget,ref)},h('b',{},ref),refLabel(ref));
}

function showPop(anchor,ref) {
  const pop=$('pop');
  const d=refDetail(ref);
  fill('pop',
    d.image?h('img',{src:d.image,alt:'',loading:'lazy',referrerpolicy:'no-referrer',class:'pop-img',onerror:(e)=>e.currentTarget.remove()}):null,
    h('h5',{},`${ref} · ${d.title}`),
    d.lines.map((l)=>h('div',{},l)),
    d.request?h('div',{class:'src'},d.request):null
  );
  pop.hidden=false;
  const r=anchor.getBoundingClientRect();
  const left=Math.min(window.scrollX+r.left,window.scrollX+document.documentElement.clientWidth-pop.offsetWidth-16);
  pop.style.left=`${Math.max(16,left)}px`;
  pop.style.top=`${window.scrollY+r.bottom+6}px`;
  pop.focus({preventScroll:true});
}

// --- render ------------------------------------------------------------------------------------

function liftBadge(p) {
  if (p.cityRank===null || p.cityRank===undefined) return h('span',{class:'lift new'},t('notTop'));
  if (p.lift>0) return h('span',{class:'lift up'},t('up',p.lift,p.cityRank));
  return h('span',{class:'lift'},t('city',p.cityRank));
}

function placeRow(p,{partner,showImage=true}={}) {
  return h('li',{class:showImage?'':'noimg'},
    h('span',{class:'rank'},`${p.tied?'=':''}${p.rank ?? ''}`),
    showImage?h('div',{class:`thumb${p.image?'':' none'}`},p.image?h('img',{src:p.image,alt:'',loading:'lazy',referrerpolicy:'no-referrer',onerror:(e)=>e.currentTarget.parentElement.classList.add('none')}):null):null,
    h('div',{class:'pbody'},
      h('div',{class:'pname'},p.name),
      p.neighborhood||p.address?h('div',{class:'paddr'},p.neighborhood ?? p.address):null,
      p.tags?.length?h('div',{class:'ptags'},p.tags.slice(0,4).map((x)=>x.name).join(' · ')):null,
      partner?h('div',{class:'partner'},`${t('partner')}: ${partner}`):null
    ),
    liftBadge(p)
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function drawMap(brief) {
  const el=$('map');
  const seen=new Set();
  const points=[...brief.peers.map((p)=>({...p,peer:true})),...brief.allPlaces]
    .filter((p)=>typeof p.lat==='number' && typeof p.lon==='number' && !seen.has(p.id) && seen.add(p.id));
  el.parentElement.hidden=!points.length || !window.L;
  if (!points.length || !window.L) return;
  if (map) { map.remove(); map=null; }
  map=window.L.map(el,{scrollWheelZoom:false});
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors'}).addTo(map);
  for (const p of points) {
    window.L.circleMarker([p.lat,p.lon],{radius:p.peer?9:6,color:'#fff',weight:2,fillColor:p.peer?'#b4532a':'#d9a07f',fillOpacity:0.95})
      .bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(t('rankLine',p,brief.input))}`)
      .addTo(map);
  }
  map.fitBounds(points.map((p)=>[p.lat,p.lon]),{padding:[24,24],maxZoom:15});
  el.setAttribute('aria-label',t('mapTitle',brief.input));
}

function render(brief,{sample=false,scroll=true}={}) {
  state.brief=brief;
  const {input,brief:b}=brief;
  $('result').hidden=false;

  $('brief-eyebrow').textContent=t('eyebrow',input);
  $('headline').textContent=b.headline;
  $('summary').textContent=b.summary ?? '';
  const cited=new Set([...b.actions.flatMap((a)=>a.refs),...b.partners.map((p)=>p.ref),...b.playlist.map((p)=>p.ref),...b.ideas.map((i)=>i.ref)]);
  const when=brief.cachedAt ?? brief.generatedAt;
  const whenText=when?new Date(when).toLocaleString(lang==='vi'?'vi-VN':'en-GB',{dateStyle:'medium',timeStyle:'short'}):null;
  fill('brief-meta',
    h('span',{},t('writtenBy',brief.engine)),
    h('span',{},t('facts',cited.size)),
    whenText?h('span',{},sample?t('saved',whenText):t('generated',whenText)):null
  );

  fill('actions',b.actions.map((a)=>h('li',{},
    h('div',{class:'t'},a.title),
    h('div',{class:'d'},a.detail),
    h('div',{class:'refs'},a.refs.map(refChip))
  )));
  $('dropped-box').hidden=!b.dropped?.length;
  if (b.dropped?.length) {
    $('dropped-title').textContent=t('dropped',b.dropped.length);
    fill('dropped',b.dropped.map((d)=>h('li',{},`${d.title} — ${d.reason}`)));
  }

  $('map-title').textContent=t('mapTitle',input);
  $('map-note').textContent=t('mapNote',input);

  const partnerWhy=new Map(b.partners.map((p)=>[p.ref,p.why]));
  $('peers-title').textContent=t('peersTitle',input);
  $('peers-note').textContent=t('peersNote',input,brief.peerCount,brief.poolSizes.peersCity);
  fill('peers',brief.peers.map((p)=>placeRow(p,{partner:partnerWhy.get(p.ref)})));
  $('all-title').textContent=t('allTitle');
  $('all-note').textContent=t('allNote',input,brief.poolSizes.market);
  const listed=new Set([...brief.allPlaces,...brief.peers].map((p)=>p.ref));
  const extraPartners=b.partners.filter((p)=>!listed.has(p.ref)).map((p)=>brief.ledger[p.ref]?.item && {...brief.ledger[p.ref].item,ref:p.ref}).filter(Boolean);
  fill('all-places',[...brief.allPlaces,...extraPartners].map((p)=>placeRow(p,{partner:partnerWhy.get(p.ref),showImage:false})));

  $('profile-note').textContent=brief.profile.length?t('profileNote',input):t('profileNone');
  fill('profile',
    brief.profile.length?h('li',{class:'legend'},h('span',{},h('i',{style:'background:var(--market)'}),t('legendMarket',input)),h('span',{},h('i',{style:'background:var(--city)'}),t('legendCity',input))):null,
    brief.profile.map((x)=>h('li',{},
      h('div',{class:'lab'},h('span',{},x.name,' ',h('span',{class:'ratio'},t('ratio',x.ratio ?? Infinity))),h('span',{},`${x.marketCount}/${x.marketTotal} vs ${x.baselineCount}/${x.baselineTotal}`)),
      h('div',{class:'bars'},
        h('div',{class:'bar m'},h('i',{style:`width:${pct(x.marketCount,x.marketTotal)}%`})),
        h('div',{class:'bar c'},h('i',{style:`width:${pct(x.baselineCount,x.baselineTotal)}%`}))
      )
    ))
  );
  $('audience').textContent=brief.audience?t('audience',input,brief.audience.summary):'';

  const notes=new Map((b.ideas ?? []).map((i)=>[i.ref,i.note]));
  $('ideas-card').hidden=!brief.ideas.length && !brief.own;
  $('ideas-note').textContent=brief.ideas.length?t('ideasNote'):'';
  fill('idea-list',brief.ideas.map((x)=>{
    const verdict=x.verdict ?? (x.status==='no-signal'?'untested':null);
    const counts=x.verdict?t('ideaCounts',x,input):x.status==='unmapped'?t('unmapped'):x.status==='not-evaluated'?t('notEvaluated'):x.via?t('entityRank',x):'';
    return h('li',{},
      h('div',{class:'itop'},h('span',{class:'iname'},x.idea),verdict?h('span',{class:`verdict ${verdict}`},t('verdict')[verdict]):null),
      h('div',{class:'why'},counts),
      notes.get(x.ref)?h('div',{class:'inote'},notes.get(x.ref)):null
    );
  }));
  const own=brief.own;
  fill('own-place',own?(
    !own.found?h('div',{},t('ownNotFound',own,input)):
    own.noSignal?h('div',{},h('strong',{},own.name),t('ownNoSignal',own,input)):
    h('div',{},h('strong',{},own.name),t('ownRank',own,input))
  ):null);

  const why=new Map(b.playlist.map((p)=>[p.ref,p.why]));
  const bridge=brief.music.bridge;
  $('music-note').textContent=bridge.length?t('musicNote',input):t('musicEmpty',input);
  const cult=(c,showLocal)=>h('li',{},c.name,h('small',{},`${input.market} #${c.rank}${showLocal&&c.localRank?` · ${input.city} #${c.localRank}`:''}`),why.get(c.ref)?h('small',{class:'cwhy'},why.get(c.ref)):null);
  fill('playlist',bridge.map((c)=>cult(c,true)));
  $('playlist').hidden=!bridge.length;
  $('distinct-title').textContent=t('distinct',input);
  fill('distinct',brief.music.distinct.map((c)=>cult(c,false)));
  fill('tv',brief.screen?.bridge?.length?h('div',{},h('h4',{},t('tvBridge')),h('ul',{class:'culture'},brief.screen.bridge.map((c)=>cult(c,true)))):null);

  const base=brief.baseline;
  document.querySelector('.contrast').hidden=!base;
  if (base) {
    fill('llm-places',base.places.map((p)=>h('li',{},
      h('span',{class:p.marketSignal?'ok':'no'},p.marketSignal?'✓':'–'),
      h('span',{},p.name,h('small',{},p.marketSignal?t('pickSignal',p,input):p.inQloo?t('pickNoSignal',p,input):t('pickMissing')))
    )));
    fill('llm-artists',base.artists.map((a)=>h('li',{},
      h('span',{class:a.qlooRank?'ok':'no'},a.qlooRank?'✓':'–'),
      h('span',{},a.name,h('small',{},a.qlooRank?t('artistHit',a,input):t('artistMiss',input,base.poolSizes.artists)))
    )));
    $('llm-advice').textContent=base.advice;
  }

  fill('caveats',[...(b.caveats ?? []),t('caveatQloo')].map((c)=>h('li',{},c)));
  fill('ledger',[...cited].filter((ref)=>brief.ledger[ref]).sort((x,y)=>x.localeCompare(y,undefined,{numeric:true})).map((ref)=>{
    const d=refDetail(ref);
    return h('div',{class:'ledger-row'},h('strong',{},ref),h('div',{},h('div',{},d.title,' — ',d.lines[0]),d.request?h('code',{},d.request):null));
  }));
  fill('trace',(brief.trace ?? []).map(stepRow));
  if (scroll) $('result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  // The map needs its container laid out before it can fit the pins.
  requestAnimationFrame(()=>drawMap(brief));
}

// --- tools -------------------------------------------------------------------------------------

function planText() {
  const {input,brief:b}=state.brief;
  const lines=[t('eyebrow',input),'',b.headline,'',b.summary,'',`${t('actions.title')}:`];
  b.actions.forEach((a,i)=>lines.push(`${i+1}. ${a.title} — ${a.detail}`));
  if (b.partners.length) {
    lines.push('',`${t('partner')}:`);
    for (const p of b.partners) lines.push(`- ${state.brief.ledger[p.ref]?.item?.name}: ${p.why}`);
  }
  lines.push('',location.origin);
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    $('tool-note').textContent=t('tools.copied');
  } catch {
    $('tool-note').textContent=t('tools.copyFail');
  }
}

function copyShareLink() {
  const i=state.brief.input;
  const q=state.sampleId
    ?new URLSearchParams({example:state.sampleId,lang})
    :new URLSearchParams({business:i.businessId,city:i.cityId,market:i.marketId,lang,...(i.ownPlace?{own:i.ownPlace}:{}),...(i.ideas?.length?{ideas:i.ideas.join('\n')}:{})});
  copyText(`${location.origin}/?${q}`);
}

init().catch((error)=>showError(`Could not load the page: ${error.message}`));
