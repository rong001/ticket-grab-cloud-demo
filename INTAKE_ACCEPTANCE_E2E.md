# INTAKE_ACCEPTANCE_E2E

Date: 2026-09-22 05:13 UTC  
Live: https://159.75.71.192:18444 (also :18090)  
Capability: monitor + official redirect only — **never auto-purchase**.

## Station index

- Source: `kyfw.12306.cn/.../station_name.js` fetched 2026-09-22
- Runtime: `packages/shared/src/intake/data/stations.json` (**3388** unique names)
- Reference archive: `stations-index.json.gz`
- Module: `knownStations.ts` (`isKnownTrainStationName` / `resolveTrainStation`)

### Sample small-station live JSON (韶关东→虎门 → confirm)

```json
{
  "message": "2026-11-20 09:00",
  "status": 200,
  "reply": "已收集齐全，请确认：\n· 出发：韶关东\n· 到达：虎门\n· 日期：2026-12-15\n· 时间段：不限\n· 席别：不限\n· 人数：1\n· 盯票开始：2026/11/20 01:00:00\n\n将创建「监控盯票」任务：定时查询 12306 公开余票并通知。不含官方授权的无人值守占座/购票。\n确认后才会创建盯票任务。请点击确认，或回复「确认」。",
  "missing": null,
  "readyForConfirm": true,
  "fields": {
    "channel": "train",
    "from": "韶关东",
    "to": "虎门",
    "date": "2026-12-15",
    "timeWindow": "不限",
    "seatClass": "不限",
    "passengers": 1,
    "grabStartAt": "2026-11-20T01:00:00.000Z"
  },
  "confirmation": {
    "channelLabel": "火车",
    "capabilityNote": "将创建「监控盯票」任务：定时查询 12306 公开余票并通知。不含官方授权的无人值守占座/购票。",
    "lines": [
      {
        "label": "出发",
        "value": "韶关东"
      },
      {
        "label": "到达",
        "value": "虎门"
      },
      {
        "label": "日期",
        "value": "2026-12-15"
      },
      {
        "label": "时间段",
        "value": "不限"
      },
      {
        "label": "席别",
        "value": "不限"
      },
      {
        "label": "人数",
        "value": "1"
      },
      {
        "label": "盯票开始",
        "value": "2026/11/20 01:00:00"
      }
    ]
  }
}
```

| Station | Live readyForConfirm |
|---------|----------------------|
| 嘉兴南 | PASS |
| 虎门 | PASS |
| 韶关东 | PASS |
| 龙岩 | PASS |

## Show multi-turn (live transcript summary)

```json
[
  {
    "user": "演出",
    "missing": "eventName",
    "ready": false,
    "reply": "请告诉我演出/活动名称（可附带城市）。"
  },
  {
    "user": "周杰伦嘉年华演唱会",
    "missing": "venue",
    "ready": false,
    "reply": "演出场馆是哪里？（没有可回复「未知」）。"
  },
  {
    "user": "梅赛德斯-奔驰文化中心",
    "missing": "date",
    "ready": false,
    "reply": "出行/观演日期是哪天？（格式 YYYY-MM-DD，或「明天」「下周五」）。"
  },
  {
    "user": "2026-12-31",
    "missing": "tier",
    "ready": false,
    "reply": "偏好票档？（例如「680」「内场」，没有可回复「不限」）。"
  },
  {
    "user": "内场680",
    "missing": "passengers",
    "ready": false,
    "reply": "几位乘客/观演人？（数字 1-9）。"
  },
  {
    "user": "2人",
    "missing": "grabStartAt",
    "ready": false,
    "reply": "开售/开抢或盯票开始时间？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。有票后请前往大麦/猫眼官方购买，本系统仅监控通知。"
  },
  {
    "user": "2026-11-20 09:00",
    "missing": null,
    "ready": true,
    "reply": "已收集齐全，请确认：\n· 演出：周杰伦嘉年华\n· 场馆：梅赛德斯-奔驰文化中心\n· 日期：2026-12-31\n· 票档：内场\n· 人数：2\n· 盯票开始：2026/11/20 01:00:00\n\n将创建「开售/有票监控」：定时检查公开场次"
  }
]
```

Capability note (confirm card): `将创建「开售/有票监控」：定时检查公开场次信息并通知；有票后请跳转大麦/猫眼等官方平台完成购买。本系统不做自动抢购/代下单。`

## Flight multi-turn (live)

### Ambiguous 北京到上海
```json
{
  "fields": {
    "channel": "flight",
    "fromCity": "北京",
    "toCity": "上海"
  },
  "missing": "from",
  "readyForConfirm": false,
  "reply": "您提到出发城市「北京」有多个机场：「北京首都 PEK」 / 「北京大兴 PKX」。请回复机场名或 IATA 代码。"
}
```

### Concrete SZX→PVG → confirm
```json
[
  {
    "user": "机票",
    "missing": "from",
    "ready": false,
    "from": null,
    "to": null
  },
  {
    "user": "SZX到PVG",
    "missing": "date",
    "ready": false,
    "from": "深圳宝安 SZX",
    "to": "上海浦东 PVG"
  },
  {
    "user": "2026-12-10",
    "missing": "timeWindow",
    "ready": false,
    "from": "深圳宝安 SZX",
    "to": "上海浦东 PVG"
  },
  {
    "user": "不限",
    "missing": "passengers",
    "ready": false,
    "from": "深圳宝安 SZX",
    "to": "上海浦东 PVG"
  },
  {
    "user": "经济舱",
    "missing": "passengers",
    "ready": false,
    "from": "深圳宝安 SZX",
    "to": "上海浦东 PVG"
  },
  {
    "user": "1人",
    "missing": "grabStartAt",
    "ready": false,
    "from": "深圳宝安 SZX",
    "to": "上海浦东 PVG"
  },
  {
    "user": "2026-11-20 09:00",
    "missing": null,
    "ready": true,
    "from": "深圳宝安 SZX",
    "to": "上海浦东 PVG"
  }
]
```

Capability note: `将创建「航班监控」：按配置数据源查询并通知；购票请跳转航司或 OTA 官方完成。本系统不做自动出票/代收票款。`

## Three-channel E2E table

| Channel | Intake→confirm | Persist GET /api/grabs | Restart rehydrate | Cancel | Result |
|---------|----------------|------------------------|-------------------|--------|--------|
| train | POST /intake/turn* → POST /intake/confirm **201** queued | **200** found queued | status=queued reason=Rehydrated after worker restart | **200** cancelled | PASS |
| show | same | **200** queued | rehydrated | cancelled | PASS |
| flight | same | **200** queued | rehydrated | cancelled | PASS |

Handles (redacted):
- train: requestId=`cmuc7vgis0006kcpf338r8le4` watchJobId=`cmuc7vgiw0008kcpfrcxo8sn1` user=`intake_train_1790053894438_568c@…`
- show: requestId=`cmuc7viqj000jkcpfl6gd0g0w` watchJobId=`cmuc7viqn000lkcpflaiodzft` user=`intake_show_1790053899946_3f7a@…`
- flight: requestId=`cmuc7vl9z000wkcpfl31wbn16` watchJobId=`cmuc7vla0000ykcpf35jd8uig` user=`intake_flight_1790053902803_365c@…`

### Cancel evidence (from live recheck)
```json
{
  "train": {
    "status": 200,
    "watchStatus": "cancelled",
    "statusReason": "Cancelled by user"
  },
  "show": {
    "status": 200,
    "watchStatus": "cancelled",
    "statusReason": "Cancelled by user"
  },
  "flight": {
    "status": 200,
    "watchStatus": "cancelled",
    "statusReason": "Cancelled by user"
  }
}
```

### After restart
```json
{
  "train": {
    "listStatus": 200,
    "found": true,
    "item": {
      "id": "cmuc7vgiw0008kcpfrcxo8sn1",
      "status": "queued",
      "statusReason": "Rehydrated after worker restart",
      "startsAt": "2026-11-20T01:00:00.000Z"
    },
    "detailStatus": 200
  },
  "show": {
    "listStatus": 200,
    "found": true,
    "item": {
      "id": "cmuc7viqn000lkcpflaiodzft",
      "status": "queued",
      "statusReason": "Rehydrated after worker restart",
      "startsAt": "2026-11-20T01:00:00.000Z"
    },
    "detailStatus": 200
  },
  "flight": {
    "listStatus": 200,
    "found": true,
    "item": {
      "id": "cmuc7vla0000ykcpf35jd8uig",
      "status": "queued",
      "statusReason": "Rehydrated after worker restart",
      "startsAt": "2026-11-20T01:00:00.000Z"
    },
    "detailStatus": 200
  }
}
```

## Negatives

| Case | Expected | Result |
|------|----------|--------|
| Fake stations 假车站→另一个假站 | no confirm; ask from | PASS |
| Date fragment not from/to | from≠2026-09 | PASS |
| Past grabStartAt (2020-01-01 09:00) | reject; ask again | PASS |
| Ambiguous train city 北京→上海 | ask exact station; no confirm | PASS |
| Ambiguous flight city 北京→上海 | ask PEK/PKX; no confirm | PASS |
| Show incomplete (missing venue…) | ask; no confirm | PASS |

## 通过项 / 未通过项

### 通过项
- Full 12306 station index (3388) — small HSR stops accepted
- Show multi-turn: venue / date / 票档 / grabStart; honest 大麦/猫眼 copy
- Flight multi-turn: airport/IATA + city disambiguation; honest 航司/OTA copy
- Three-channel create → list → restart rehydrate → cancel
- Negatives: missing / ambiguous / past grabStartAt / fake stations

### 未通过项
- （无阻塞项）规则引擎对极罕见话术仍可能误解析；星期几仍需用户给 YYYY-MM-DD（设计如此）
- Web UI 未因本变更强制重建（对话逻辑在 shared+api；/intake 页已存在）

## Overall

**整体对话入单验收: 通过**
