/** Shared option catalogs for searchable pickers on /requests/new */

export type SelectOption = {
  value: string;
  label: string;
  category: string;
};

/** Major cities for train city-first picker (full station lists come from /meta/stations?city=). */
export const TRAIN_CITIES: SelectOption[] = [
  { value: "北京", label: "北京", category: "华北" },
  { value: "天津", label: "天津", category: "华北" },
  { value: "石家庄", label: "石家庄", category: "华北" },
  { value: "太原", label: "太原", category: "华北" },
  { value: "呼和浩特", label: "呼和浩特", category: "华北" },
  { value: "上海", label: "上海", category: "华东" },
  { value: "杭州", label: "杭州", category: "华东" },
  { value: "南京", label: "南京", category: "华东" },
  { value: "苏州", label: "苏州", category: "华东" },
  { value: "无锡", label: "无锡", category: "华东" },
  { value: "合肥", label: "合肥", category: "华东" },
  { value: "济南", label: "济南", category: "华东" },
  { value: "青岛", label: "青岛", category: "华东" },
  { value: "福州", label: "福州", category: "华东" },
  { value: "厦门", label: "厦门", category: "华东" },
  { value: "南昌", label: "南昌", category: "华东" },
  { value: "宁波", label: "宁波", category: "华东" },
  { value: "温州", label: "温州", category: "华东" },
  { value: "广州", label: "广州", category: "粤港澳" },
  { value: "深圳", label: "深圳", category: "粤港澳" },
  { value: "珠海", label: "珠海", category: "粤港澳" },
  { value: "东莞", label: "东莞", category: "粤港澳" },
  { value: "佛山", label: "佛山", category: "粤港澳" },
  { value: "惠州", label: "惠州", category: "粤港澳" },
  { value: "汕头", label: "汕头", category: "粤港澳" },
  { value: "汕尾", label: "汕尾", category: "粤港澳" },
  { value: "南宁", label: "南宁", category: "粤港澳" },
  { value: "海口", label: "海口", category: "粤港澳" },
  { value: "三亚", label: "三亚", category: "粤港澳" },
  { value: "武汉", label: "武汉", category: "华中" },
  { value: "长沙", label: "长沙", category: "华中" },
  { value: "郑州", label: "郑州", category: "华中" },
  { value: "成都", label: "成都", category: "西南" },
  { value: "重庆", label: "重庆", category: "西南" },
  { value: "昆明", label: "昆明", category: "西南" },
  { value: "贵阳", label: "贵阳", category: "西南" },
  { value: "西安", label: "西安", category: "西北" },
  { value: "兰州", label: "兰州", category: "西北" },
  { value: "乌鲁木齐", label: "乌鲁木齐", category: "西北" },
  { value: "哈尔滨", label: "哈尔滨", category: "东北" },
  { value: "长春", label: "长春", category: "东北" },
  { value: "沈阳", label: "沈阳", category: "东北" },
  { value: "大连", label: "大连", category: "东北" },
];

export const TRAIN_STATIONS: SelectOption[] = [
  // 东北
  { value: "哈尔滨西", label: "哈尔滨西", category: "东北" },
  { value: "哈尔滨", label: "哈尔滨", category: "东北" },
  { value: "长春", label: "长春", category: "东北" },
  { value: "长春西", label: "长春西", category: "东北" },
  { value: "沈阳", label: "沈阳", category: "东北" },
  { value: "沈阳北", label: "沈阳北", category: "东北" },
  { value: "沈阳南", label: "沈阳南", category: "东北" },
  { value: "大连", label: "大连", category: "东北" },
  { value: "大连北", label: "大连北", category: "东北" },
  { value: "鞍山", label: "鞍山", category: "东北" },
  { value: "锦州南", label: "锦州南", category: "东北" },
  { value: "丹东", label: "丹东", category: "东北" },
  { value: "吉林", label: "吉林", category: "东北" },
  { value: "延吉西", label: "延吉西", category: "东北" },
  { value: "齐齐哈尔南", label: "齐齐哈尔南", category: "东北" },
  { value: "牡丹江", label: "牡丹江", category: "东北" },
  // 华北
  { value: "北京南", label: "北京南", category: "华北" },
  { value: "北京西", label: "北京西", category: "华北" },
  { value: "北京朝阳", label: "北京朝阳", category: "华北" },
  { value: "北京", label: "北京", category: "华北" },
  { value: "北京北", label: "北京北", category: "华北" },
  { value: "北京丰台", label: "北京丰台", category: "华北" },
  { value: "天津西", label: "天津西", category: "华北" },
  { value: "天津", label: "天津", category: "华北" },
  { value: "天津南", label: "天津南", category: "华北" },
  { value: "石家庄", label: "石家庄", category: "华北" },
  { value: "石家庄东", label: "石家庄东", category: "华北" },
  { value: "雄安", label: "雄安", category: "华北" },
  { value: "唐山", label: "唐山", category: "华北" },
  { value: "秦皇岛", label: "秦皇岛", category: "华北" },
  { value: "保定东", label: "保定东", category: "华北" },
  { value: "邯郸东", label: "邯郸东", category: "华北" },
  { value: "张家口", label: "张家口", category: "华北" },
  { value: "大同南", label: "大同南", category: "华北" },
  { value: "太原南", label: "太原南", category: "华北" },
  { value: "呼和浩特东", label: "呼和浩特东", category: "华北" },
  // 华东
  { value: "上海虹桥", label: "上海虹桥", category: "华东" },
  { value: "上海", label: "上海", category: "华东" },
  { value: "上海松江", label: "上海松江", category: "华东" },
  { value: "上海南", label: "上海南", category: "华东" },
  { value: "杭州东", label: "杭州东", category: "华东" },
  { value: "杭州", label: "杭州", category: "华东" },
  { value: "杭州西", label: "杭州西", category: "华东" },
  { value: "南京南", label: "南京南", category: "华东" },
  { value: "南京", label: "南京", category: "华东" },
  { value: "苏州", label: "苏州", category: "华东" },
  { value: "苏州北", label: "苏州北", category: "华东" },
  { value: "无锡", label: "无锡", category: "华东" },
  { value: "无锡东", label: "无锡东", category: "华东" },
  { value: "常州", label: "常州", category: "华东" },
  { value: "常州北", label: "常州北", category: "华东" },
  { value: "镇江南", label: "镇江南", category: "华东" },
  { value: "宁波", label: "宁波", category: "华东" },
  { value: "温州南", label: "温州南", category: "华东" },
  { value: "金华", label: "金华", category: "华东" },
  { value: "嘉兴南", label: "嘉兴南", category: "华东" },
  { value: "绍兴北", label: "绍兴北", category: "华东" },
  { value: "台州", label: "台州", category: "华东" },
  { value: "合肥南", label: "合肥南", category: "华东" },
  { value: "合肥", label: "合肥", category: "华东" },
  { value: "芜湖", label: "芜湖", category: "华东" },
  { value: "黄山北", label: "黄山北", category: "华东" },
  { value: "徐州东", label: "徐州东", category: "华东" },
  { value: "连云港", label: "连云港", category: "华东" },
  { value: "盐城", label: "盐城", category: "华东" },
  { value: "南通", label: "南通", category: "华东" },
  { value: "淮安东", label: "淮安东", category: "华东" },
  { value: "济南西", label: "济南西", category: "华东" },
  { value: "济南", label: "济南", category: "华东" },
  { value: "济南东", label: "济南东", category: "华东" },
  { value: "青岛", label: "青岛", category: "华东" },
  { value: "青岛北", label: "青岛北", category: "华东" },
  { value: "烟台", label: "烟台", category: "华东" },
  { value: "潍坊", label: "潍坊", category: "华东" },
  { value: "淄博", label: "淄博", category: "华东" },
  { value: "临沂北", label: "临沂北", category: "华东" },
  { value: "日照西", label: "日照西", category: "华东" },
  { value: "福州", label: "福州", category: "华东" },
  { value: "福州南", label: "福州南", category: "华东" },
  { value: "厦门", label: "厦门", category: "华东" },
  { value: "厦门北", label: "厦门北", category: "华东" },
  { value: "泉州", label: "泉州", category: "华东" },
  { value: "莆田", label: "莆田", category: "华东" },
  { value: "宁德", label: "宁德", category: "华东" },
  { value: "武夷山北", label: "武夷山北", category: "华东" },
  { value: "南昌西", label: "南昌西", category: "华东" },
  { value: "南昌", label: "南昌", category: "华东" },
  { value: "赣州西", label: "赣州西", category: "华东" },
  { value: "九江", label: "九江", category: "华东" },
  // 华南 / 粤港澳
  { value: "广州南", label: "广州南", category: "粤港澳" },
  { value: "广州东", label: "广州东", category: "粤港澳" },
  { value: "广州", label: "广州", category: "粤港澳" },
  { value: "广州北", label: "广州北", category: "粤港澳" },
  { value: "深圳北", label: "深圳北", category: "粤港澳" },
  { value: "深圳", label: "深圳", category: "粤港澳" },
  { value: "深圳东", label: "深圳东", category: "粤港澳" },
  { value: "福田", label: "福田", category: "粤港澳" },
  { value: "深圳西", label: "深圳西", category: "粤港澳" },
  { value: "香港西九龙", label: "香港西九龙", category: "粤港澳" },
  { value: "珠海", label: "珠海", category: "粤港澳" },
  { value: "中山", label: "中山", category: "粤港澳" },
  { value: "东莞南", label: "东莞南", category: "粤港澳" },
  { value: "东莞", label: "东莞", category: "粤港澳" },
  { value: "惠州南", label: "惠州南", category: "粤港澳" },
  { value: "惠州北", label: "惠州北", category: "粤港澳" },
  { value: "佛山西", label: "佛山西", category: "粤港澳" },
  { value: "肇庆东", label: "肇庆东", category: "粤港澳" },
  { value: "汕尾", label: "汕尾", category: "粤港澳" },
  { value: "汕头", label: "汕头", category: "粤港澳" },
  { value: "潮汕", label: "潮汕", category: "粤港澳" },
  { value: "揭阳", label: "揭阳", category: "粤港澳" },
  { value: "湛江西", label: "湛江西", category: "粤港澳" },
  { value: "茂名", label: "茂名", category: "粤港澳" },
  { value: "阳江", label: "阳江", category: "粤港澳" },
  { value: "韶关", label: "韶关", category: "粤港澳" },
  { value: "清远", label: "清远", category: "粤港澳" },
  { value: "南宁东", label: "南宁东", category: "粤港澳" },
  { value: "南宁", label: "南宁", category: "粤港澳" },
  { value: "桂林北", label: "桂林北", category: "粤港澳" },
  { value: "柳州", label: "柳州", category: "粤港澳" },
  { value: "北海", label: "北海", category: "粤港澳" },
  { value: "海口东", label: "海口东", category: "粤港澳" },
  { value: "海口", label: "海口", category: "粤港澳" },
  { value: "三亚", label: "三亚", category: "粤港澳" },
  // 华中
  { value: "武汉", label: "武汉", category: "华中" },
  { value: "汉口", label: "汉口", category: "华中" },
  { value: "武昌", label: "武昌", category: "华中" },
  { value: "长沙南", label: "长沙南", category: "华中" },
  { value: "长沙", label: "长沙", category: "华中" },
  { value: "郑州东", label: "郑州东", category: "华中" },
  { value: "郑州", label: "郑州", category: "华中" },
  { value: "洛阳龙门", label: "洛阳龙门", category: "华中" },
  { value: "襄阳东", label: "襄阳东", category: "华中" },
  { value: "宜昌东", label: "宜昌东", category: "华中" },
  { value: "荆州", label: "荆州", category: "华中" },
  { value: "岳阳东", label: "岳阳东", category: "华中" },
  { value: "衡阳东", label: "衡阳东", category: "华中" },
  { value: "株洲西", label: "株洲西", category: "华中" },
  { value: "怀化南", label: "怀化南", category: "华中" },
  { value: "邵阳", label: "邵阳", category: "华中" },
  { value: "信阳东", label: "信阳东", category: "华中" },
  { value: "南阳东", label: "南阳东", category: "华中" },
  { value: "驻马店西", label: "驻马店西", category: "华中" },
  // 西南
  { value: "成都东", label: "成都东", category: "西南" },
  { value: "成都", label: "成都", category: "西南" },
  { value: "成都南", label: "成都南", category: "西南" },
  { value: "重庆西", label: "重庆西", category: "西南" },
  { value: "重庆北", label: "重庆北", category: "西南" },
  { value: "重庆", label: "重庆", category: "西南" },
  { value: "沙坪坝", label: "沙坪坝", category: "西南" },
  { value: "绵阳", label: "绵阳", category: "西南" },
  { value: "德阳", label: "德阳", category: "西南" },
  { value: "乐山", label: "乐山", category: "西南" },
  { value: "宜宾西", label: "宜宾西", category: "西南" },
  { value: "泸州", label: "泸州", category: "西南" },
  { value: "南充北", label: "南充北", category: "西南" },
  { value: "万州北", label: "万州北", category: "西南" },
  { value: "贵阳北", label: "贵阳北", category: "西南" },
  { value: "贵阳东", label: "贵阳东", category: "西南" },
  { value: "遵义", label: "遵义", category: "西南" },
  { value: "昆明南", label: "昆明南", category: "西南" },
  { value: "昆明", label: "昆明", category: "西南" },
  { value: "大理", label: "大理", category: "西南" },
  { value: "丽江", label: "丽江", category: "西南" },
  { value: "西昌", label: "西昌", category: "西南" },
  { value: "拉萨", label: "拉萨", category: "西南" },
  // 西北
  { value: "西安北", label: "西安北", category: "西北" },
  { value: "西安", label: "西安", category: "西北" },
  { value: "咸阳北", label: "咸阳北", category: "西北" },
  { value: "宝鸡南", label: "宝鸡南", category: "西北" },
  { value: "兰州西", label: "兰州西", category: "西北" },
  { value: "兰州", label: "兰州", category: "西北" },
  { value: "天水南", label: "天水南", category: "西北" },
  { value: "西宁", label: "西宁", category: "西北" },
  { value: "银川", label: "银川", category: "西北" },
  { value: "乌鲁木齐", label: "乌鲁木齐", category: "西北" },
  { value: "乌鲁木齐南", label: "乌鲁木齐南", category: "西北" },
  { value: "吐鲁番北", label: "吐鲁番北", category: "西北" },
  { value: "哈密", label: "哈密", category: "西北" },
  { value: "嘉峪关南", label: "嘉峪关南", category: "西北" },
  { value: "张掖西", label: "张掖西", category: "西北" },
  { value: "中卫南", label: "中卫南", category: "西北" },
];

export const SEAT_CLASSES: SelectOption[] = [
  { value: "二等座", label: "二等座", category: "席别" },
  { value: "一等座", label: "一等座", category: "席别" },
  { value: "商务座", label: "商务座", category: "席别" },
  { value: "特等座", label: "特等座", category: "席别" },
  { value: "软卧", label: "软卧", category: "席别" },
  { value: "硬卧", label: "硬卧", category: "席别" },
  { value: "动卧", label: "动卧", category: "席别" },
  { value: "高级软卧", label: "高级软卧", category: "席别" },
  { value: "软座", label: "软座", category: "席别" },
  { value: "硬座", label: "硬座", category: "席别" },
  { value: "无座", label: "无座", category: "席别" },
];

export const SHOW_CITIES: SelectOption[] = [
  // 一线
  { value: "北京", label: "北京", category: "一线" },
  { value: "上海", label: "上海", category: "一线" },
  { value: "广州", label: "广州", category: "一线" },
  { value: "深圳", label: "深圳", category: "一线" },
  // 新一线
  { value: "成都", label: "成都", category: "新一线" },
  { value: "杭州", label: "杭州", category: "新一线" },
  { value: "重庆", label: "重庆", category: "新一线" },
  { value: "武汉", label: "武汉", category: "新一线" },
  { value: "西安", label: "西安", category: "新一线" },
  { value: "苏州", label: "苏州", category: "新一线" },
  { value: "南京", label: "南京", category: "新一线" },
  { value: "天津", label: "天津", category: "新一线" },
  { value: "长沙", label: "长沙", category: "新一线" },
  { value: "郑州", label: "郑州", category: "新一线" },
  { value: "东莞", label: "东莞", category: "新一线" },
  { value: "青岛", label: "青岛", category: "新一线" },
  { value: "沈阳", label: "沈阳", category: "新一线" },
  { value: "宁波", label: "宁波", category: "新一线" },
  { value: "昆明", label: "昆明", category: "新一线" },
  { value: "无锡", label: "无锡", category: "新一线" },
  // 二三线常见
  { value: "厦门", label: "厦门", category: "二三线" },
  { value: "福州", label: "福州", category: "二三线" },
  { value: "合肥", label: "合肥", category: "二三线" },
  { value: "济南", label: "济南", category: "二三线" },
  { value: "大连", label: "大连", category: "二三线" },
  { value: "哈尔滨", label: "哈尔滨", category: "二三线" },
  { value: "南宁", label: "南宁", category: "二三线" },
  { value: "贵阳", label: "贵阳", category: "二三线" },
  { value: "海口", label: "海口", category: "二三线" },
  { value: "三亚", label: "三亚", category: "二三线" },
  { value: "南昌", label: "南昌", category: "二三线" },
  { value: "石家庄", label: "石家庄", category: "二三线" },
  { value: "太原", label: "太原", category: "二三线" },
  { value: "长春", label: "长春", category: "二三线" },
  { value: "兰州", label: "兰州", category: "二三线" },
  { value: "呼和浩特", label: "呼和浩特", category: "二三线" },
  { value: "乌鲁木齐", label: "乌鲁木齐", category: "二三线" },
  { value: "佛山", label: "佛山", category: "二三线" },
  { value: "珠海", label: "珠海", category: "二三线" },
  { value: "惠州", label: "惠州", category: "二三线" },
  { value: "中山", label: "中山", category: "二三线" },
  { value: "嘉兴", label: "嘉兴", category: "二三线" },
  { value: "绍兴", label: "绍兴", category: "二三线" },
  { value: "温州", label: "温州", category: "二三线" },
  { value: "金华", label: "金华", category: "二三线" },
  { value: "泉州", label: "泉州", category: "二三线" },
  { value: "常州", label: "常州", category: "二三线" },
  { value: "徐州", label: "徐州", category: "二三线" },
  { value: "洛阳", label: "洛阳", category: "二三线" },
];

export const SHOW_VENUES: SelectOption[] = [
  { value: "国家体育场（鸟巢）", label: "国家体育场（鸟巢）", category: "北京" },
  { value: "工人体育馆", label: "工人体育馆", category: "北京" },
  { value: "首都体育馆", label: "首都体育馆", category: "北京" },
  { value: "国家体育馆", label: "国家体育馆", category: "北京" },
  { value: "梅赛德斯-奔驰文化中心", label: "梅赛德斯-奔驰文化中心", category: "上海" },
  { value: "上海体育馆", label: "上海体育馆", category: "上海" },
  { value: "虹口足球场", label: "虹口足球场", category: "上海" },
  { value: "静安体育中心", label: "静安体育中心", category: "上海" },
  { value: "广州体育馆", label: "广州体育馆", category: "广州" },
  { value: "宝安体育场", label: "宝安体育场", category: "深圳" },
  { value: "深圳湾体育中心", label: "深圳湾体育中心", category: "深圳" },
  { value: "春茧体育馆", label: "春茧体育馆", category: "深圳" },
  { value: "成都东安湖体育公园", label: "成都东安湖体育公园", category: "成都" },
  { value: "成都凤凰山体育公园", label: "成都凤凰山体育公园", category: "成都" },
  { value: "杭州奥体中心", label: "杭州奥体中心", category: "杭州" },
  { value: "南京奥体中心", label: "南京奥体中心", category: "南京" },
  { value: "武汉体育中心", label: "武汉体育中心", category: "武汉" },
  { value: "西安奥体中心", label: "西安奥体中心", category: "西安" },
];

/**
 * Cabin labels (Chinese) for the form; map to adapter keys via `toCabinCode`.
 * Adapters expect: economy | premium_economy | business | first
 */
export const FLIGHT_CABINS: SelectOption[] = [
  { value: "经济舱", label: "经济舱", category: "舱位" },
  { value: "超级经济舱", label: "超级经济舱", category: "舱位" },
  { value: "公务舱", label: "公务舱", category: "舱位" },
  { value: "头等舱", label: "头等舱", category: "舱位" },
];

const CABIN_TO_CODE: Record<string, string> = {
  经济舱: "economy",
  超级经济舱: "premium_economy",
  公务舱: "business",
  头等舱: "first",
  economy: "economy",
  premium_economy: "premium_economy",
  business: "business",
  first: "first",
};

/** Normalize form cabin (Chinese or english) to adapter code. */
export function toCabinCode(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  return CABIN_TO_CODE[t] ?? CABIN_TO_CODE[t.toLowerCase()] ?? t;
}

export const FLIGHT_AIRPORTS: SelectOption[] = [
  // 国内枢纽
  { value: "PEK", label: "北京首都 PEK", category: "国内枢纽" },
  { value: "PKX", label: "北京大兴 PKX", category: "国内枢纽" },
  { value: "PVG", label: "上海浦东 PVG", category: "国内枢纽" },
  { value: "SHA", label: "上海虹桥 SHA", category: "国内枢纽" },
  { value: "CAN", label: "广州白云 CAN", category: "国内枢纽" },
  { value: "SZX", label: "深圳宝安 SZX", category: "国内枢纽" },
  { value: "CTU", label: "成都双流 CTU", category: "国内枢纽" },
  { value: "TFU", label: "成都天府 TFU", category: "国内枢纽" },
  { value: "CKG", label: "重庆江北 CKG", category: "国内枢纽" },
  { value: "XIY", label: "西安咸阳 XIY", category: "国内枢纽" },
  { value: "HGH", label: "杭州萧山 HGH", category: "国内枢纽" },
  { value: "NKG", label: "南京禄口 NKG", category: "国内枢纽" },
  { value: "WUH", label: "武汉天河 WUH", category: "国内枢纽" },
  { value: "CSX", label: "长沙黄花 CSX", category: "国内枢纽" },
  { value: "KMG", label: "昆明长水 KMG", category: "国内枢纽" },
  { value: "XMN", label: "厦门高崎 XMN", category: "国内枢纽" },
  { value: "TAO", label: "青岛胶东 TAO", category: "国内枢纽" },
  { value: "SYX", label: "三亚凤凰 SYX", category: "国内枢纽" },
  { value: "HAK", label: "海口美兰 HAK", category: "国内枢纽" },
  { value: "URC", label: "乌鲁木齐地窝堡 URC", category: "国内枢纽" },
  { value: "SHE", label: "沈阳桃仙 SHE", category: "国内枢纽" },
  { value: "DLC", label: "大连周水子 DLC", category: "国内枢纽" },
  { value: "TSN", label: "天津滨海 TSN", category: "国内枢纽" },
  { value: "CGO", label: "郑州新郑 CGO", category: "国内枢纽" },
  { value: "FOC", label: "福州长乐 FOC", category: "国内枢纽" },
  { value: "NGB", label: "宁波栎社 NGB", category: "国内枢纽" },
  { value: "HFE", label: "合肥新桥 HFE", category: "国内枢纽" },
  { value: "NNG", label: "南宁吴圩 NNG", category: "国内枢纽" },
  { value: "KWE", label: "贵阳龙洞堡 KWE", category: "国内枢纽" },
  { value: "LHW", label: "兰州中川 LHW", category: "国内枢纽" },
  { value: "HRB", label: "哈尔滨太平 HRB", category: "国内枢纽" },
  { value: "CGQ", label: "长春龙嘉 CGQ", category: "国内枢纽" },
  { value: "TNA", label: "济南遥墙 TNA", category: "二级机场" },
  { value: "WNZ", label: "温州龙湾 WNZ", category: "二级机场" },
  { value: "JJN", label: "泉州晋江 JJN", category: "二级机场" },
  { value: "KHN", label: "南昌昌北 KHN", category: "二级机场" },
  { value: "TYN", label: "太原武宿 TYN", category: "二级机场" },
  { value: "SJW", label: "石家庄正定 SJW", category: "二级机场" },
  { value: "INC", label: "银川河东 INC", category: "二级机场" },
  { value: "XNN", label: "西宁曹家堡 XNN", category: "二级机场" },
  { value: "LUM", label: "德宏芒市 LUM", category: "二级机场" },
  { value: "DLU", label: "大理 DLU", category: "二级机场" },
  { value: "LJG", label: "丽江三义 LJG", category: "二级机场" },
  { value: "KWL", label: "桂林两江 KWL", category: "二级机场" },
  // 港澳台 / 国际常见
  { value: "HKG", label: "香港国际 HKG", category: "热门" },
  { value: "MFM", label: "澳门国际 MFM", category: "热门" },
  { value: "TPE", label: "台北桃园 TPE", category: "热门" },
  { value: "NRT", label: "东京成田 NRT", category: "热门" },
  { value: "HND", label: "东京羽田 HND", category: "热门" },
  { value: "ICN", label: "首尔仁川 ICN", category: "热门" },
  { value: "SIN", label: "新加坡樟宜 SIN", category: "热门" },
  { value: "BKK", label: "曼谷素万那普 BKK", category: "热门" },
  { value: "LAX", label: "洛杉矶 LAX", category: "热门" },
  { value: "SFO", label: "旧金山 SFO", category: "热门" },
  { value: "JFK", label: "纽约肯尼迪 JFK", category: "热门" },
  { value: "LHR", label: "伦敦希思罗 LHR", category: "热门" },
  { value: "CDG", label: "巴黎戴高乐 CDG", category: "热门" },
  { value: "FRA", label: "法兰克福 FRA", category: "热门" },
];

export function categoriesOf(options: SelectOption[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    if (!seen.has(o.category)) {
      seen.add(o.category);
      out.push(o.category);
    }
  }
  return out;
}

/** Local YYYY-MM-DD helpers for date chips */
export function todayISO(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return formatISODate(d);
}

export function plusDaysISO(days: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + days);
  return formatISODate(d);
}

/** Next Saturday (or today if already Saturday). */
export function nextSaturdayISO(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDay();
  const delta = day === 6 ? 0 : (6 - day + 7) % 7;
  d.setDate(d.getDate() + delta);
  return formatISODate(d);
}

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
