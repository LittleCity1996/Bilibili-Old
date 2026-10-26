import md5 from "md5";
import { URL } from "../utils/format/url";

/** WBI 签名：B站 web 接口风控要求。
 * 从 /x/web-interface/nav 获取 img_key/sub_key，通过 mixinKey 表重排得到 mixinKey，
 * 参数排序后 md5 签名。需要完整的浏览器请求头（Referer/Origin/UA）。
 */
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
];

let __wbiCache: { key: string, time: number } | undefined;

/** 获取 WBI mixinKey，缓存 1 小时 */
async function wbiMixinKey(): Promise<string> {
    if (__wbiCache && Date.now() - __wbiCache.time < 3600e3) return __wbiCache.key;
    try {
        const d = await (await fetch("https://api.bilibili.com/x/web-interface/nav", {
            credentials: "include",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.bilibili.com/",
                "Origin": "https://www.bilibili.com",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
        })).json();
        const img: string = d?.data?.wbi_img?.img_url || "";
        const sub: string = d?.data?.wbi_img?.sub_url || "";
        if (!img || !sub) return "";
        const raw = img.split("/").pop()!.split(".")[0] + sub.split("/").pop()!.split(".")[0];
        const key = MIXIN_KEY_ENC_TAB.map(i => raw[i] || "").join("").slice(0, 32);
        __wbiCache = { key, time: Date.now() };
        return key;
    } catch (e) {
        return "";
    }
}

/** 生成 WBI 签名查询字符串 */
export async function wbiQuery(params: Record<string, string | number>): Promise<string> {
    const key = await wbiMixinKey();
    const p: Record<string, any> = Object.assign({}, params, { wts: Math.round(Date.now() / 1000) });
    const q = Object.keys(p)
        .sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ""))}`)
        .join("&");
    const sign = md5(q + key);
    return key ? `${q}&w_rid=${sign}` : q;
}

/** 带 WBI 签名的 fetch 请求 */
export async function wbiFetch(url: string, params: Record<string, string | number>, init?: RequestInit): Promise<Response> {
    const q = await wbiQuery(params);
    const sep = url.includes("?") ? "&" : "?";
    return fetch(`${url}${sep}${q}`, {
        credentials: "include",
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.bilibili.com/",
            "Origin": "https://www.bilibili.com",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        ...init,
    });
}
