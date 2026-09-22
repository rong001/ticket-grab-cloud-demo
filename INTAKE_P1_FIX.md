# INTAKE P1 FIX — measured live API

Host: https://159.75.71.192:18444

## Summary

- All required cases: **PASS**

| Case | Kind | Result | from | to | passengers | missing | ready |
|------|------|--------|------|----|------------|---------|-------|
| P1_exact | pos | PASS | 北京南 | 上海虹桥 | 2 | grabStartAt | False |
| P1_spaced | pos | PASS | 北京南 | 上海虹桥 | 2 | grabStartAt | False |
| P1_cn_date | pos | PASS | 北京南 | 上海虹桥 | 2 | None | True |
| P1_date_after | pos | PASS | 北京南 | 上海虹桥 | 2 | timeWindow | False |
| N_fake | neg | PASS | None | None |  | from | False |

## Exact failing sentence (measured)

### Request
```json
{
  "message": "2026-09-29北京南到上海虹桥，08:00-10:00，二等座，两张"
}
```
### Response (redacted — no secrets)
```json
{
  "sessionId": "630dd27e-92ae-4f68-8642-0eb790288b94",
  "fields": {
    "channel": "train",
    "from": "北京南",
    "to": "上海虹桥",
    "date": "2026-09-29",
    "timeWindow": "08:00-10:00",
    "seatClass": "二等座",
    "passengers": 2
  },
  "missing": "grabStartAt",
  "readyForConfirm": false,
  "confirmation": null,
  "reply": "何时开始盯票/抢票？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。"
}
```

## All measured responses

### P1_exact (PASS)
```json
{
  "request": {
    "message": "2026-09-29北京南到上海虹桥，08:00-10:00，二等座，两张"
  },
  "response": {
    "sessionId": "630dd27e-92ae-4f68-8642-0eb790288b94",
    "fields": {
      "channel": "train",
      "from": "北京南",
      "to": "上海虹桥",
      "date": "2026-09-29",
      "timeWindow": "08:00-10:00",
      "seatClass": "二等座",
      "passengers": 2
    },
    "missing": "grabStartAt",
    "readyForConfirm": false,
    "confirmation": null,
    "reply": "何时开始盯票/抢票？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。"
  }
}
```

### P1_spaced (PASS)
```json
{
  "request": {
    "message": "2026-09-29 北京南到上海虹桥 08:00-10:00 二等座 两人"
  },
  "response": {
    "sessionId": "5da980b2-2974-4e59-85f6-cf5e58f4ab7b",
    "fields": {
      "channel": "train",
      "from": "北京南",
      "to": "上海虹桥",
      "date": "2026-09-29",
      "timeWindow": "08:00-10:00",
      "seatClass": "二等座",
      "passengers": 2
    },
    "missing": "grabStartAt",
    "readyForConfirm": false,
    "confirmation": null,
    "reply": "何时开始盯票/抢票？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。"
  }
}
```

### P1_cn_date (PASS)
```json
{
  "request": {
    "message": "9月29日北京南→上海虹桥，上午8点到10点，二等，两张票"
  },
  "response": {
    "sessionId": "56d2c749-473d-466c-b845-ecbaf419b406",
    "fields": {
      "channel": "train",
      "from": "北京南",
      "to": "上海虹桥",
      "date": "2026-09-29",
      "timeWindow": "08:00-10:00",
      "seatClass": "二等座",
      "passengers": 2,
      "grabStartAt": "2026-09-22T08:00:00.000Z"
    },
    "missing": null,
    "readyForConfirm": true,
    "confirmation": {
      "channel": "train",
      "channelLabel": "火车",
      "lines": [
        {
          "label": "出发",
          "value": "北京南"
        },
        {
          "label": "到达",
          "value": "上海虹桥"
        },
        {
          "label": "日期",
          "value": "2026-09-29"
        },
        {
          "label": "时间段",
          "value": "08:00-10:00"
        },
        {
          "label": "席别",
          "value": "二等座"
        },
        {
          "label": "人数",
          "value": "2"
        },
        {
          "label": "盯票开始",
          "value": "2026/9/22 08:00:00"
        }
      ],
      "capabilityNote": "将创建「监控盯票」任务：定时查询 12306 公开余票并通知。不含官方授权的无人值守占座/购票。",
      "fields": {
        "channel": "train",
        "from": "北京南",
        "to": "上海虹桥",
        "date": "2026-09-29",
        "timeWindow": "08:00-10:00",
        "seatClass": "二等座",
        "passengers": 2,
        "grabStartAt": "2026-09-22T08:00:00.000Z"
      }
    },
    "reply": "已收集齐全，请确认：\n· 出发：北京南\n· 到达：上海虹桥\n· 日期：2026-09-29\n· 时间段：08:00-10:00\n· 席别：二等座\n· 人数：2\n· 盯票开始：2026/9/22 08:00:00\n\n将创建「监控盯票」任务：定时查询 12306 公开余票并通知。不含官方授权的无人值守占座/购票。\n确认后才会创建盯票任务。请点击确认，或回复「确认」。"
  }
}
```

### P1_date_after (PASS)
```json
{
  "request": {
    "message": "北京南到上海虹桥 2026-09-29 二等座 2张"
  },
  "response": {
    "sessionId": "de0cd021-b542-4465-ab2f-a90aee5f8ebb",
    "fields": {
      "channel": "train",
      "from": "北京南",
      "to": "上海虹桥",
      "date": "2026-09-29",
      "seatClass": "二等座",
      "passengers": 2
    },
    "missing": "timeWindow",
    "readyForConfirm": false,
    "confirmation": null,
    "reply": "希望的时间段？（例如「08:00-12:00」「下午」「晚上」，没有可回复「不限」）。"
  }
}
```

### N_fake (PASS)
```json
{
  "request": {
    "message": "2026-09-29假车站到另一个假站，二等座，两张"
  },
  "response": {
    "sessionId": "5c611ac8-3234-4529-900c-2f9590337059",
    "fields": {
      "channel": "train",
      "date": "2026-09-29",
      "seatClass": "二等座",
      "passengers": 2
    },
    "missing": "from",
    "readyForConfirm": false,
    "confirmation": null,
    "reply": "请告诉我确切出发站（不要只写城市）。例如「北京南」「北京西」「北京站」。"
  }
}
```
