import { BLOD } from "../../core/bilibili-old";
import { IAidDatail } from "../../io/api";
import { apiNewlist } from "../../io/api-newlist";
import htmlChannel from "../../html/channel.html";
import { debug } from "../../utils/debug";
import { urlObj } from "../../utils/format/url";
import { propertyHook } from "../../utils/hook/method";
import { jsonpHook } from "../../utils/hook/node";
import { poll } from "../../utils/poll";
import { Header } from "../header";
import { Page } from "../page";

const DOUGA = {
    parent: 1,
    regions: [24, 25, 47, 210, 86, 27],
};

export class PageChannel extends Page {
    private feedCache = new Map<number, Promise<IAidDatail[]>>();
    constructor() {
        super(htmlChannel);
        this.rewriteLegacyPath();
        Header.prid = 1576;
        Header.primaryMenu();
        Header.banner();
        this.initState();
        this.feed();
        this.updateDom();
        this.sliderData();
    }
    private rewriteLegacyPath() {
        if (/^\/c\/douga\/?$/.test(location.pathname)) {
            history.replaceState(null, "", `/v/douga/${location.search}${location.hash}`);
        }
    }
    private initState() {
        propertyHook(window, "__INITIAL_STATE__", undefined);
    }
    private feed() {
        const isRegion = (url: string) => DOUGA.regions.includes(Number(urlObj(url).rid));
        jsonpHook.async("api.bilibili.com/x/web-interface/dynamic/region", isRegion, async url => {
            const obj = urlObj(url);
            return this.feedResponse(Number(obj.rid), Number(obj.ps) || 15);
        }, false);
        jsonpHook.async("api.bilibili.com/x/web-interface/newlist", isRegion, async url => {
            const obj = urlObj(url);
            return this.feedResponse(Number(obj.rid), Number(obj.ps) || 15);
        }, false);
    }
    private feedResponse(tid: number, ps: number) {
        return this.feedArchives(tid, ps).then(archives => {
            return { code: 0, message: "0", ttl: 1, data: { archives } };
        });
    }
    private async feedArchives(tid: number, ps: number) {
        try {
            const list = await this.getParentNewlist(DOUGA.parent);
            const archives = list.filter(d => d.tid === tid);
            if (archives.length >= ps) return archives.slice(0, ps);
            const rank = await this.getRegionRank(tid);
            const aids = new Set(archives.map(d => d.aid));
            return archives.concat(rank.filter(d => !aids.has(d.aid))).slice(0, ps);
        } catch (e) {
            debug.error("channel feed", e);
            return <IAidDatail[]>[];
        }
    }
    private getParentNewlist(rid: number) {
        if (!this.feedCache.has(rid)) {
            this.feedCache.set(rid, apiNewlist(rid, 50).catch(e => {
                debug.error("channel newlist", e);
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
            debug.error("channel ranking feed", e);
            return <IAidDatail[]>[];
        }
    }
    get carousel() {
        switch (BLOD.path[4]) {
            case 'douga': return 4973;
            // case 'music': return 4991;
        }
    }
    private sliderData() {
        const carousel = this.carousel;
        if (carousel) {
            poll(() => document.querySelector<any>('.channel-m>.nominate-m'), slider => {
                fetch(`https://api.bilibili.com/x/web-show/res/locs?pf=0&ids=${carousel}`).then(d => d.json()).then(d => {
                    const data = d?.data?.[carousel];
                    if (slider && slider.__vue__ && Array.isArray(data)) {
                        slider.__vue__.sliderData = data.filter((d: any) => d.name);
                    }
                })
            })
        }
    }
}