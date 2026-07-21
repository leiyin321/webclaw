import { MESSAGE_ITEM_TYPE } from "./wechat-api.js";

export function extractText(itemList) {
  if (!Array.isArray(itemList)) return "";
  for (const item of itemList) {
    if (item?.type === MESSAGE_ITEM_TYPE.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      const quoted = [];
      if (ref.title) quoted.push(ref.title);
      if (ref.message_item) {
        const refText = extractText([ref.message_item]);
        if (refText) quoted.push(refText);
      }
      return quoted.length ? `[引用: ${quoted.join(" | ")}]\n${text}` : text;
    }
    if (item?.type === MESSAGE_ITEM_TYPE.VOICE && item.voice_item?.text) {
      return String(item.voice_item.text);
    }
  }
  return "";
}

export function summarizeMessage(message) {
  const text = extractText(message.item_list);
  const mediaTypes = (Array.isArray(message.item_list) ? message.item_list : [])
    .map((item) => item?.type)
    .filter((type) => type && type !== MESSAGE_ITEM_TYPE.TEXT);
  return {
    id: message.message_id || message.client_id || message.seq || "",
    from: message.from_user_id || "",
    to: message.to_user_id || "",
    text,
    mediaTypes,
    contextToken: message.context_token || "",
    timestamp: message.create_time_ms || Date.now(),
    itemList: Array.isArray(message.item_list) ? message.item_list : []
  };
}
