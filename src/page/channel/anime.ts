import { IAidDatail } from "../../io/api";
import { apiNewlist } from "../../io/api-newlist";
import htmlAnime from "../../html/anime.html";
import { debug } from "../../utils/debug";
import { urlObj } from "../../utils/format/url";
import { propertyHook } from "../../utils/hook/method";
import { xhrHook } from "../../utils/hook/xhr";
import { Header } from "../header";
import { Page } from "../page";

const SUB_REGIONS = [32, 33, 51, 152, 153, 168, 170, 195];
const STRICT_REGIONS = [51, 152];

export class PageAnime extends Page {
    private feedCache = new Map<number, Promise<IAidDatail[]>>();
    constructor() {
        super(htmlAnime);
        Header.prid = location.pathname.includes('anime') ? 1612 : 1920;
        Header.primaryMenu();
        Header.banner();
        this.initState();
        this.feed();
        this.updateDom();
        this.handPickList();
    }
    /** 清除新版页面的 __INITIAL_STATE__，让旧页重新执行 asyncData */
    private initState() {
        propertyHook(window, '__INITIAL_STATE__', undefined);
    }
    /** 修复已失效的分区动态接口 */
    private feed() {
        xhrHook.async("api.bilibili.com/x/web-interface/dynamic/region", undefined, async args => {
            const response = JSON.stringify(await this.feedResponse(Number(urlObj(args[1]).rid)));
            return { response, responseText: response };
        }, false);
        xhrHook.async("api.bilibili.com/x/web-interface/newlist", args => {
            return SUB_REGIONS.includes(Number(urlObj(args[1]).rid));
        }, async args => {
            const response = JSON.stringify(await this.feedResponse(Number(urlObj(args[1]).rid)));
            return { response, responseText: response };
        }, false);
    }
    private feedResponse(tid: number) {
        return this.feedArchives(tid).then(archives => {
            return { code: 0, message: "0", ttl: 1, data: { archives } };
        });
    }
    private async feedArchives(tid: number) {
        try {
            const parent = location.pathname.includes("anime") ? 13 : 167;
            const list = await this.getParentNewlist(parent);
            const archives = list.filter(d => d.tid === tid);
            if (archives.length >= 10 || STRICT_REGIONS.includes(tid)) return archives.slice(0, 10);
            const rank = await this.getRegionRank(tid);
            const aids = new Set(archives.map(d => d.aid));
            return archives.concat(rank.filter(d => !aids.has(d.aid))).slice(0, 10);
        } catch (e) {
            debug.error("anime feed", e);
            return <IAidDatail[]>[];
        }
    }
    private getParentNewlist(rid: number) {
        if (!this.feedCache.has(rid)) {
            this.feedCache.set(rid, apiNewlist(rid, 50).catch(e => {
                debug.error("anime newlist", e);
                return <IAidDatail[]>[];
            }));
        }
        return this.feedCache.get(rid)!;
    }
    private async getRegionRank(tid: number) {
        try {
            const response = await fetch(`https://api.bilibili.com/x/web-interface/ranking/region?rid=${tid}&day=3&original=0`, {
                credentials: "include"
            });
            const json = await response.json();
            if (json.code !== 0 || !Array.isArray(json.data)) return <IAidDatail[]>[];
            return <IAidDatail[]>json.data.map((d: any) => ({
                ...d,
                stat: { view: d.play || 0, danmaku: d.video_review || 0, coin: d.coins || 0 },
                owner: { name: d.author || "", mid: d.mid || 0 },
                pubdate: d.create ? Math.floor(new Date(d.create).getTime() / 1000) : 0
            }));
        } catch (e) {
            debug.error("anime ranking feed", e);
            return <IAidDatail[]>[];
        }
    }
    /** 修复编辑推荐 */
    private handPickList() {
        xhrHook(['pgc/operation/api/static', 'position_id=52'], undefined, () => {
            setTimeout(() => {
                const d = document.querySelector<any>('.hot-recom-module')
                if (d && d.__vue__) {
                    d.__vue__.renderList = JSON.parse(JSON.stringify(d.__vue__.HAND_PICK_LIST));
                }
            })
        }, false);
    }
}