import { IAidDatail } from "../../io/api";
import { apiNewlist } from "../../io/api-newlist";
import { wbiFetch } from "../../io/api-wbi";
import htmlChannel from "../../html/channel.html";
import { debug } from "../../utils/debug";
import { objUrl, urlObj } from "../../utils/format/url";
import { pubdateFormat } from "../../utils/format/time";
import { propertyHook } from "../../utils/hook/method";
import { jsonpHook } from "../../utils/hook/node";
import { poll } from "../../utils/poll";
import { Header } from "../header";
import { Page } from "../page";

interface IChannelConfig {
    /** 旧版频道页路由名（/v/<route>/） */
    route: string;
    /** 父分区 tid */
    parent: number;
    /** 子分区 tid */
    regions: number[];
    /** 轮播 locid */
    locid: number;
    /**
     * 新版分区 pid，用于 ranking/v2 与 region/feed/rcmd。
     * 取多个时会合并（生活区被拆散在不同新版分区里）。
     */
    rankRegions: number[];
}

/**
 * 普通分区配置，取自旧版 channel bundle（channel.<hash>.js）里的频道表。
 * rankRegions 为实测可用的新版分区 pid（ranking/v2 返回当前数据且带子分区 tid）。
 */
const CHANNELS: Record<string, IChannelConfig> = {
    douga: { route: "douga", parent: 1, regions: [24, 25, 47, 210, 86, 27], locid: 52, rankRegions: [1005] },
    music: { route: "music", parent: 3, regions: [28, 31, 30, 194, 59, 193, 29, 130], locid: 58, rankRegions: [1003] },
    dance: { route: "dance", parent: 129, regions: [20, 198, 199, 200, 154, 156], locid: 64, rankRegions: [1004] },
    game: { route: "game", parent: 4, regions: [17, 171, 172, 65, 173, 121, 136, 19], locid: 70, rankRegions: [1008] },
    knowledge: { route: "technology", parent: 36, regions: [201, 124, 207, 208, 209, 122], locid: 76, rankRegions: [1010] },
    tech: { route: "digital", parent: 188, regions: [95, 189, 190, 191], locid: 2977, rankRegions: [1012] },
    // 1029/1031 仍是 2025 冻结数据，改用可用的 1018/1024/1013 合并补齐
    life: { route: "life", parent: 160, regions: [138, 21, 75, 161, 162, 163, 176, 174], locid: 88, rankRegions: [1018, 1024, 1013] },
    food: { route: "food", parent: 211, regions: [76, 212, 213, 214, 215], locid: 4243, rankRegions: [1020] },
    kichiku: { route: "kichiku", parent: 119, regions: [22, 26, 126, 216, 127], locid: 100, rankRegions: [1007] },
    fashion: { route: "fashion", parent: 155, regions: [157, 158, 164, 159, 192], locid: 94, rankRegions: [1014] },
    // 资讯的新版分区已下线（1009 返回 -400），排行暂无实时来源
    information: { route: "information", parent: 202, regions: [203, 204, 205, 206], locid: 4076, rankRegions: [] },
    ent: { route: "ent", parent: 5, regions: [71, 137], locid: 82, rankRegions: [1002] },
    cinephile: { route: "cinephile", parent: 181, regions: [182, 183, 85, 184], locid: 2211, rankRegions: [1001] },
};

/** 旧版路由名 -> 配置键，兼容 /v/technology/、/c/technology/ 这类旧写法 */
const LEGACY_ROUTES: Record<string, string> = {};
Object.keys(CHANNELS).forEach(key => {
    const route = CHANNELS[key].route;
    if (route !== key) LEGACY_ROUTES[route] = key;
});

/**
 * 匹配普通分区页地址
 * @param pathname location.pathname
 * @returns 配置键，未命中返回 undefined
 */
export function matchPageChannel(pathname: string): string | undefined {
    const match = pathname.match(/^\/(?:c|v)\/([a-z]+)\/?$/);
    if (!match) return undefined;
    const name = match[1];
    if (CHANNELS[name]) return name;
    return LEGACY_ROUTES[name];
}

export class PageChannel extends Page {
    private config: IChannelConfig;
    /** 父分区最新投稿 */
    private newlistCache = new Map<number, Promise<any[]>>();
    /** region/feed/rcmd（需登录，未登录返回空） */
    private regionFeedCache = new Map<number, Promise<any[]>>();
    /** ranking/v2 */
    private rankCache = new Map<string, Promise<any[]>>();
    constructor(channel: string) {
        const config = CHANNELS[channel];
        if (!config) throw new Error(`unknown channel: ${channel}`);
        super(htmlChannel);
        this.config = config;
        this.rewriteLegacyPath();
        Header.prid = (<Record<number, number>>Header.tid)[config.parent] ?? 0;
        Header.primaryMenu();
        Header.banner();
        this.initState();
        this.feed();
        this.ranking();
        this.updateDom();
        this.fillBlocks();
    }
    private rewriteLegacyPath() {
        if (/^\/c\//.test(location.pathname)) {
            history.replaceState(null, "", `/v/${this.config.route}/${location.search}${location.hash}`);
        }
    }
    private initState() {
        propertyHook(window, "__INITIAL_STATE__", undefined);
    }
    /** 有新动态与最新投稿必须不同源，否则两个标签页内容会一模一样 */
    private feed() {
        const regions = this.config.regions;
        const isRegion = (url: string) => regions.includes(Number(urlObj(url).rid));
        // 有新动态：主页同款的分区推荐流，拿不到时退回分区排行
        jsonpHook.async("api.bilibili.com/x/web-interface/dynamic/region", isRegion, async url => {
            const obj = urlObj(url);
            const archives = await this.dynamicArchives(Number(obj.rid), Number(obj.ps) || 15);
            return { code: 0, message: "0", ttl: 1, data: { archives } };
        }, false);
        // 最新投稿：父分区最新投稿按子分区过滤
        jsonpHook.async("api.bilibili.com/x/web-interface/newlist", isRegion, async url => {
            const obj = urlObj(url);
            return this.feedResponse(Number(obj.rid), Number(obj.ps) || 15);
        }, false);
        // 资讯频道的模块读 data.items，且只有"最新投稿"
        jsonpHook.async("api.bilibili.com/x/web-interface/information", isRegion, async url => {
            const obj = urlObj(url);
            const archives = await this.newestArchives(Number(obj.rid), Number(obj.ps) || 15);
            const items = archives.map((d: any) => ({ ...d, cover: d.pic, author: d.owner, id: d.aid }));
            return { code: 0, message: "0", ttl: 1, data: { items } };
        }, false);
    }
    /** 分区排行榜（右侧热门列）：页面请求的 ranking/region 已冻结，改由 ranking/v2 供数 */
    private ranking() {
        if (!this.config.rankRegions.length) return;
        const regions = this.config.regions;
        jsonpHook.async("api.bilibili.com/x/web-interface/ranking/region", url => regions.includes(Number(urlObj(url).rid)), async url => {
            const obj = urlObj(url);
            const tid = Number(obj.rid);
            const type = obj.original === "1" ? "origin" : "all";
            const data = (await this.getRankingByTid(tid, type)).slice(0, 10).map(d => this.rankItem(d));
            return { code: 0, message: "0", ttl: 1, data };
        }, false);
    }
    private feedResponse(tid: number, ps: number) {
        return this.newestArchives(tid, ps).then(archives => {
            return { code: 0, message: "0", ttl: 1, data: { archives } };
        });
    }
    /** 最新投稿：父分区最新投稿按子分区过滤，按发布时间倒序 */
    private async newestArchives(tid: number, ps: number) {
        try {
            const list = await this.getParentNewlist(this.config.parent);
            return <IAidDatail[]>this.pickByTid([list], tid, ps);
        } catch (e) {
            debug.error("channel newest", e);
            return <IAidDatail[]>[];
        }
    }
    /** 有新动态：分区推荐流优先，其次分区排行（两者都与最新投稿不同源） */
    private async dynamicArchives(tid: number, ps: number) {
        try {
            const feeds = await Promise.all(this.config.rankRegions.map(code => this.getRegionFeed(code)));
            const archives = this.pickByTid(feeds, tid, ps);
            if (archives.length) return <IAidDatail[]>archives;
            const ranks = await Promise.all(this.config.rankRegions.map(code => this.getRanking(code, "all")));
            return <IAidDatail[]>this.pickByTid(ranks, tid, ps);
        } catch (e) {
            debug.error("channel dynamic", e);
            return <IAidDatail[]>[];
        }
    }
    /** 多来源按子分区 tid 过滤、按 aid 去重、按发布时间倒序取前 ps 条 */
    private pickByTid(lists: any[][], tid: number, ps: number) {
        const seen = new Set<any>();
        const archives: any[] = [];
        for (const list of lists) {
            for (const d of list) {
                if (d.tid !== tid) continue;
                const key = d.aid || d.bvid;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                archives.push(d);
            }
        }
        return archives.sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0)).slice(0, ps);
    }
    /** 父分区最新投稿 */
    private getParentNewlist(rid: number) {
        if (!this.newlistCache.has(rid)) {
            this.newlistCache.set(rid, apiNewlist(rid, 50).catch(e => {
                debug.error("channel newlist", e);
                return <any[]>[];
            }));
        }
        return this.newlistCache.get(rid)!;
    }
    /** 新版分区推荐流（需登录） */
    private getRegionFeed(code: number) {
        if (!this.regionFeedCache.has(code)) {
            this.regionFeedCache.set(code, (async () => {
                try {
                    const response = await fetch(objUrl("https://api.bilibili.com/x/web-interface/region/feed/rcmd", {
                        display_id: 1,
                        request_cnt: 30,
                        from_region: code,
                        device: "web",
                        plat: 30,
                        web_location: 333.40138
                    }), {
                        credentials: "include"
                    });
                    const json = await response.json();
                    if (json.code !== 0 || !json.data || !Array.isArray(json.data.archives)) return <any[]>[];
                    return json.data.archives.map((d: any) => ({
                        ...d,
                        pic: d.cover || d.pic,
                        owner: d.author,
                        stat: Object.assign({ view: 0, danmaku: 0, coin: 0 }, d.stat)
                    }));
                } catch (e) {
                    debug.error("channel region feed", e);
                    return <any[]>[];
                }
            })());
        }
        return this.regionFeedCache.get(code)!;
    }
    /** 新版分区排行 ranking/v2 */
    private getRanking(code: number, type: "all" | "origin") {
        const key = `${code}:${type}`;
        if (!this.rankCache.has(key)) {
            this.rankCache.set(key, (async () => {
                try {
                    const response = await wbiFetch("https://api.bilibili.com/x/web-interface/ranking/v2", {
                        rid: code,
                        type,
                        web_location: 333.934
                    }, {
                        credentials: "include"
                    });
                    const json = await response.json();
                    if (json.code !== 0 || !json.data || !Array.isArray(json.data.list)) return <any[]>[];
                    return json.data.list;
                } catch (e) {
                    debug.error("channel ranking v2", e);
                    return <any[]>[];
                }
            })());
        }
        return this.rankCache.get(key)!;
    }
    private async getRankingByTid(tid: number, type: "all" | "origin") {
        const lists = await Promise.all(this.config.rankRegions.map(code => this.getRanking(code, type)));
        return lists.reduce((s, list) => s.concat(list.filter(d => d.tid === tid)), <any[]>[]);
    }
    /** ranking/v2 字段 -> 旧版排行组件字段 */
    private rankItem(d: any) {
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
            create: pubdateFormat(d.pubdate)
        };
    }
    get carousel() {
        return this.config.locid;
    }
    /**
     * 顶部的轮播与"前方高能"原本依赖 res/locs 内容位（locid / Energy 的 titleId,leftId,rightId），
     * 官方已把这些内容位全部下架（返回 null），组件于是显示"没有数据(-_-#)"。
     * 这里改用分区实时热门（ranking/v2）填充：等组件自己的请求结束且结果为空时再补。
     */
    private fillBlocks() {
        if (!this.config.rankRegions.length) return;
        const started = Date.now();
        const settled = (vue: any) => vue.state !== "loading" || Date.now() - started > 5000;
        this.getChannelHot().then(list => {
            if (!list.length) return;
            poll(() => {
                const vue = (<any>document.querySelector('.nominate-m'))?.__vue__;
                return vue && settled(vue) ? vue : undefined;
            }, vue => {
                if (!(vue.sliderData || []).length) vue.sliderData = this.slideItems(list);
            });
            poll(() => {
                const vue = (<any>document.querySelector('.energy-m'))?.__vue__;
                return vue && settled(vue) ? vue : undefined;
            }, vue => {
                if (!(vue.videoData || []).length) vue.videoData = list.slice(0, 6);
                if (!(vue.hotData || []).length) vue.hotData = this.slideItems(list).slice(0, 8);
            });
        }).catch(e => debug.error("channel fill blocks", e));
    }
    /** 分区实时热门（多个新版 pid 合并去重，保持 ranking/v2 的热度顺序） */
    private async getChannelHot() {
        const lists = await Promise.all(this.config.rankRegions.map(code => this.getRanking(code, "all")));
        const seen = new Set<any>();
        const list: any[] = [];
        for (const d of lists.reduce((s, l) => s.concat(l), <any[]>[])) {
            const key = d.aid || d.bvid;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            list.push(d);
        }
        return list;
    }
    /** 轮播/Energy 右侧需要的字段：id/name/title/pic/url(+aid) */
    private slideItems(list: any[]) {
        return list.slice(0, 5).map(d => ({
            id: d.aid,
            aid: d.aid,
            name: d.title,
            title: d.title,
            pic: d.pic,
            url: `/video/${d.bvid}`
        }));
    }
}