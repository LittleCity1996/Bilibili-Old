import { urlCleaner } from '../core/url';
import html from '../html/ranking.html';
import { wbiFetch } from "../io/api-wbi";
import { debug } from "../utils/debug";
import { addCss } from "../utils/element";
import { urlObj } from "../utils/format/url";
import { propertyHook } from "../utils/hook/method";
import { jsonpHook } from "../utils/hook/node";
import { Header } from "./header";
import { Page } from "./page";

const RANKING_PAGE_CODES: Record<number, number> = {
    0: 0,
    1: 1005,
    3: 1003,
    4: 1008,
    5: 1002,
    36: 1010,
    119: 1007,
    129: 1004,
    155: 1014,
    181: 1001,
    188: 1012,
    211: 1013
};

function mapRankingItem(d: any): any {
    return {
        ...d,
        play: d.stat?.view || 0,
        video_review: d.stat?.danmaku || 0,
        favorites: d.stat?.favorite || 0,
        coins: d.stat?.coin || 0,
        review: d.stat?.reply || 0,
        pts: d.score || 0,
        author: d.owner?.name || "",
        mid: d.owner?.mid || 0,
        description: d.desc || "",
        typename: d.tname || "",
        others: Array.isArray(d.others) ? d.others.map(mapRankingItem) : d.others
    };
}

async function fetchRankingPageData(tid: number) {
    const region = RANKING_PAGE_CODES[tid];
    if (region === undefined) return { note: "", list: <any[]>[] };
    try {
        const response = await wbiFetch("https://api.bilibili.com/x/web-interface/ranking/v2", {
            rid: region,
            type: "all",
            web_location: 333.934
        }, {
            credentials: "include"
        });
        const json = await response.json();
        if (json.code !== 0 || !json.data || !Array.isArray(json.data.list)) return { note: "", list: <any[]>[] };
        return {
            note: json.data.note || "",
            list: json.data.list.map(mapRankingItem)
        };
    } catch (e) {
        debug.error("ranking", e);
        return { note: "", list: <any[]>[] };
    }
}

export class PageRanking extends Page {
    constructor() {
        super(html);
        this.location();
        this.overDue();
        this.rankingList();
        this.initState();
        Header.primaryMenu();
        Header.banner();
        this.updateDom();
    }
    /** 还原正确的排行地址否则页面无法正常初始化 */
    protected location() {
        if (/^\/(?:v\/)?ranking(?:\/|$)/.test(location.pathname)) return;
        urlCleaner.updateLocation(/ranking/.test(document.referrer) ? document.referrer : "https://www.bilibili.com/ranking");
    }
    /** 三日以外的数据全部过期 */
    protected overDue() {
        jsonpHook(["api.bilibili.com/x/web-interface/ranking", "arc_type=0"], d => d.replace(/day=\d+/, "day=3"), undefined, false);
    }
    protected rankingList() {
        jsonpHook.async("api.bilibili.com/x/web-interface/ranking", url => {
            const obj = urlObj(url);
            const tid = Number(obj.rid);
            const type = obj.type || "1";
            const arcType = obj.arc_type || "0";
            return type === "1" && arcType === "0" && RANKING_PAGE_CODES[tid] !== undefined;
        }, async url => {
            const data = await fetchRankingPageData(Number(urlObj(url).rid));
            return { code: 0, message: "0", ttl: 1, data };
        }, false);
    }
    /** 禁用错误的__INITIAL_STATE__ */
    protected initState() {
        propertyHook(window, '__INITIAL_STATE__', undefined);
    }
    /** 优化高分辨率支持 */
    protected style() {
        addCss("@media screen and (min-width: 1400px){.main-inner {width: 1160px !important;}}");
    }
}