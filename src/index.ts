"use strict";
// const siyuan = require("siyuan");
import * as siyuan from "siyuan";

import { manageCustomIcons, uploadCustomIcon, useDynamicStyle } from "./custom-icon";

import './style.css';

const ICON_CLASS = "plugin-link-icon";
const EVENT_LOADED_PROTYLE = 'loaded-protyle-static';

type TEventLoadedProtyle = CustomEvent<siyuan.IEventBusMap['loaded-protyle-static']>;

async function request(url, data) {
    // info(`Request: ${url}; data = ${JSON.stringify(data)}`);
    let response = await siyuan.fetchSyncPost(url, data);
    // console.log(response);
    let res = response.code === 0 ? response.data : null;
    return res;
}


async function sql(sql) {
    let sqldata = {
        stmt: sql,
    };
    let url = '/api/query/sql';
    return request(url, sqldata);
}

/**
 * 获取文档块的图标
 * @param {string} block_id
 */
async function queryDocIcon(block_id) {
    //如果不是文档块，则不添加图标
    let blocks = await sql(`select * from blocks where id = '${block_id}'`);
    if (blocks?.length === 0 || blocks[0].type !== 'd') {
        // console.log(`block ${block_id} is not a doc`)
        return null;
    }

    let response = await siyuan.fetchSyncPost(
        '/api/block/getDocInfo',
        {
            id: block_id
        }
    );
    if (response.code !== 0) {
        return null;
    }

    let icon_code = response.data.icon;
    let sub_file_cnt = response.data.subFileCount;

    // 默认文档图标
    if (icon_code === "") {
        let code = sub_file_cnt > 0 ? '📑' : '📄';
        let dom = `<span data-type="text" class="${ICON_CLASS}">${code}</span>`
        return {
            type: 'unicode',
            dom: dom,
            code: code
        }
    }

    let result = {
        type: "unicode",
        dom: "",
        code: icon_code
    }
    //使用了自定义的 svg 图标 vs 使用 unicode 编码的 emoji
    if (icon_code.toLowerCase().endsWith(".svg")) {
        result.type = "svg";
        result.dom = `<img alt="${icon_code}" class="emoji ${ICON_CLASS}" src="/emojis/${icon_code}" title="${icon_code}">`
    } else if (icon_code.toLowerCase().match(/\.(jpeg|jpg|png|ico)$/)) {
        result.type = "image";
        result.dom = `<img alt="${icon_code}" class="${ICON_CLASS}" src="/emojis/${icon_code}" title="${icon_code}" style="width: 1.625em; height: 1.625em; padding-right: 3px; padding-bottom:3px; border-radius: 0.5em">`
    } else if (icon_code.startsWith("api/icon/getDynamicIcon?")) {
        result.type = "dynamic";
        result.dom = `<img alt="${icon_code}" class="${ICON_CLASS}" src="${icon_code}" title="${icon_code}" style="width: 1.625em; height: 1.625em; padding-right: 3px; padding-bottom:3px; border-radius: 0.5em">`
    } else {
        result.type = "unicode";
        result.code = String.fromCodePoint(parseInt(icon_code, 16))
        result.dom = `<span data-type="text" class="${ICON_CLASS}">${result.code}</span>`
    }

    return result;
}

const SINGLE_CHAR_CLASS = "link-icon-single-char";
const HIDE_SINGLE_CHAR_BODY_CLASS = "link-icon--hide-single-char";
const LINK_SELECTOR = "span[data-type~='a'], span[data-type~='url'], a[href]";

const segmenter = typeof Intl !== "undefined" && (Intl as any).Segmenter
    ? new (Intl as any).Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * 链接文本（去掉首尾空白）是否只有一个字符（按字素计，emoji 算一个）
 */
function isSingleCharText(text: string | null | undefined) {
    const t = (text ?? "").replace(/[​﻿]/g, "").trim();
    if (t.length === 0) return false;
    if (segmenter) {
        let n = 0;
        for (const _ of segmenter.segment(t)) {
            if (++n > 1) return false;
        }
        return n === 1;
    }
    return Array.from(t).length === 1;
}

/**
 * 给单字符链接打标记（class 不会被思源写回数据，重渲染后由观察器重新标记）
 */
function markSingleCharLink(el: Element) {
    const single = isSingleCharText(el.textContent);
    if (single !== el.classList.contains(SINGLE_CHAR_CLASS)) {
        el.classList.toggle(SINGLE_CHAR_CLASS, single);
    }
}

function markSingleCharLinksIn(root: ParentNode) {
    if (root instanceof Element && root.matches(LINK_SELECTOR)) {
        markSingleCharLink(root);
    }
    root.querySelectorAll?.(LINK_SELECTOR).forEach(markSingleCharLink);
}

function isUnicodeEmoji(text) {
    const regex = /\p{Emoji}/u;
    return regex.test(text);
}

const ConfigFile = 'config.json';
const customIconsFile = 'custom-icons.json';

const simpleDialog = (args: {
    title: string, ele: HTMLElement | DocumentFragment,
    width?: string, height?: string,
    callback?: () => void;
}) => {
    const dialog = new siyuan.Dialog({
        title: args.title,
        content: `<div class="dialog-content" style="display: flex; height: 100%;"/>`,
        width: args.width,
        height: args.height,
        destroyCallback: args.callback
    });
    dialog.element.querySelector(".dialog-content").appendChild(args.ele);
    return dialog;
}

const dynamicStyle = useDynamicStyle();

export default class LinkIconPlugin extends siyuan.Plugin {

    Listener = this.listeners.bind(this);

    config = {
        InsertDocRefIcon: true,
        InsertDocLinkIcon: false,
        SingleCharLinkIcon: true
    }

    private singleCharObserver: MutationObserver | null = null;
    private pendingRoots = new Set<Node>();
    private flushScheduled = false;

    customIcons: { href: string, iconUrl: string }[] = []

    async onload() {
        this.initUI();

        let conf = await this.loadData(ConfigFile);
        let customIcons = await this.loadData(customIconsFile);
        this.customIcons = customIcons || [];
        if (conf) {
            for (let key in this.config) {
                let val = conf?.[key];
                if (val !== undefined) {
                    this.config[key] = val;
                }
            }
        }
        this.customIcons.forEach(icon => {
            dynamicStyle.addIcon(icon.href, icon.iconUrl, false);
        });
        dynamicStyle.flushStyle();
        this.eventBus.on(EVENT_LOADED_PROTYLE, this.Listener);
        this.applySingleCharSetting();
    }

    async onunload() {
        this.eventBus.off(EVENT_LOADED_PROTYLE, this.Listener);
        dynamicStyle.clearStyle();
        this.stopSingleCharObserver();
        document.body.classList.remove(HIDE_SINGLE_CHAR_BODY_CLASS);
    }

    /**
     * 根据配置开启/关闭单字符链接图标隐藏：
     * 关闭图标时给 body 加 class，并用观察器持续标记单字符链接
     */
    applySingleCharSetting() {
        const hide = !this.config.SingleCharLinkIcon;
        document.body.classList.toggle(HIDE_SINGLE_CHAR_BODY_CLASS, hide);
        if (hide) {
            markSingleCharLinksIn(document.body);
            this.startSingleCharObserver();
        } else {
            this.stopSingleCharObserver();
        }
    }

    private startSingleCharObserver() {
        if (this.singleCharObserver) return;
        this.singleCharObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === "characterData") {
                    const link = m.target.parentElement?.closest(LINK_SELECTOR);
                    if (link) this.pendingRoots.add(link);
                    continue;
                }
                const target = m.target as Element;
                const link = target.closest?.(LINK_SELECTOR);
                if (link) this.pendingRoots.add(link);
                m.addedNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) this.pendingRoots.add(n);
                });
            }
            this.scheduleFlush();
        });
        this.singleCharObserver.observe(document.body, {
            childList: true, subtree: true, characterData: true
        });
    }

    private stopSingleCharObserver() {
        this.singleCharObserver?.disconnect();
        this.singleCharObserver = null;
        this.pendingRoots.clear();
    }

    private scheduleFlush() {
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        requestAnimationFrame(() => {
            this.flushScheduled = false;
            const roots = [...this.pendingRoots];
            this.pendingRoots.clear();
            roots.forEach(r => {
                if (r.isConnected) markSingleCharLinksIn(r as ParentNode);
            });
        });
    }

    initUI() {
        const inputDocRef = document.createElement('input');
        inputDocRef.type = 'checkbox';
        inputDocRef.className = "b3-switch fn__flex-center";
        const inputDocLink = document.createElement('input');
        inputDocLink.type = 'checkbox';
        inputDocLink.className = "b3-switch fn__flex-center";
        const inputSingleChar = document.createElement('input');
        inputSingleChar.type = 'checkbox';
        inputSingleChar.className = "b3-switch fn__flex-center";
        const uploadBtn = document.createElement('button');
        uploadBtn.className = "b3-button fn__size200";
        uploadBtn.textContent = this.i18n.upload;
        uploadBtn.addEventListener('click', async () => {
            let ele = uploadCustomIcon((hrefName: string, url: string) => {
                dialog.destroy();
                this.onCustomIconUpload(hrefName, url);
            });
            const dialog = simpleDialog({
                title: this.i18n.upload,
                ele: ele,
                width: '700px',
            });
        });
        const manageBtn = document.createElement('button');
        manageBtn.className = "b3-button fn__size200";
        manageBtn.textContent = this.i18n.manage;
        manageBtn.addEventListener('click', async () => {
            let ele = manageCustomIcons(
                this.customIcons,
                (updatedIcons: typeof this.customIcons) => {
                    console.debug(`Updated custom icons: ${updatedIcons}`);
                    this.customIcons = updatedIcons;
                    dynamicStyle.removeAllIcons();
                    this.customIcons.forEach(icon => {
                        dynamicStyle.addIcon(icon.href, icon.iconUrl, false);
                    });
                    dynamicStyle.flushStyle();
                    this.saveData(customIconsFile, this.customIcons);
                },
                () => {
                    dialog.destroy();
                }
            );
            const dialog = simpleDialog({
                title: this.i18n.manage,
                ele: ele,
                width: '400px',
            });

        });

        this.setting = new siyuan.Setting({
            width: '700px',
            height: '500px',
            confirmCallback: () => {
                this.config.InsertDocRefIcon = inputDocRef.checked;
                this.config.InsertDocLinkIcon = inputDocLink.checked;
                this.config.SingleCharLinkIcon = inputSingleChar.checked;
                this.saveData(ConfigFile, this.config);
                this.applySingleCharSetting();
            }
        });
        this.setting.addItem({
            title: this.i18n.InputDocRef.title,
            description: this.i18n.InputDocRef.description,
            createActionElement: () => {
                inputDocRef.checked = this.config.InsertDocRefIcon;
                return inputDocRef;
            },
        });
        this.setting.addItem({
            title: this.i18n.InputDocLink.title,
            description: this.i18n.InputDocLink.description,
            createActionElement: () => {
                inputDocLink.checked = this.config.InsertDocLinkIcon;
                return inputDocLink;
            },
        });
        this.setting.addItem({
            title: this.i18n.SingleCharLinkIcon.title,
            description: this.i18n.SingleCharLinkIcon.description,
            createActionElement: () => {
                inputSingleChar.checked = this.config.SingleCharLinkIcon;
                return inputSingleChar;
            },
        });
        this.setting.addItem({
            title: this.i18n.upload,
            // description: '上传自定义的 svg 图标或图片文件',
            createActionElement: () => {
                return uploadBtn;
            }
        });
        this.setting.addItem({
            title: this.i18n.manage,
            // description: '查看并管理所有自定义的图标',
            createActionElement: () => {
                return manageBtn;
            }
        });
    }

    private onCustomIconUpload(href: string, iconUrl: string) {
        console.debug(`Upload custom icon: ${href} -> ${iconUrl}`);
        dynamicStyle.addIcon(href, iconUrl);
        this.customIcons.push({ href, iconUrl });
        this.saveData(customIconsFile, this.customIcons);
        // Assume it is implemented by others
        // No need to complete this function
    }

    async listeners(event: TEventLoadedProtyle) {
        // 仅给触发加载文档的元素添加块引用图标
        let doc = event.detail?.protyle?.element;

        if (!doc) {
            console.warn("Listener failed to get protyle element");
            return;
        }

        if (this.config.InsertDocRefIcon) {
            let ref_list = doc.querySelectorAll("span[data-type='block-ref']");
            ref_list.forEach(async (element) => {
                let block_id = element.attributes["data-id"].value;
                this.insertDocIconBefore(element, block_id);
            });
        }

        if (this.config.InsertDocLinkIcon) {
            let url_list = doc.querySelectorAll("span[data-type=a][data-href^=siyuan]");
            url_list.forEach(async (element) => {
                let data_href = element.attributes["data-href"].value;
                const pattern = new RegExp("siyuan:\\/\\/blocks\\/(.*)");
                const result = data_href.match(pattern);
                if (result) {
                    if (!this.config.SingleCharLinkIcon && isSingleCharText(element.textContent)) {
                        return;
                    }
                    const block_id = result[1];
                    this.insertDocIconBefore(element, block_id);
                }
            });
        }
    }

    /**
     * 
     * @param {HTMLSpanElement} element Span element
     */
    async insertDocIconBefore(element, block_id) {
        let previes_sibling = element.previousElementSibling;
        //如果前面的 span 元素是我们自定义插入的 icon, 就直接退出不管
        //不过实测由于思源会把自定义的 class 删掉, 所以这行逻辑没啥卵用...
        if (previes_sibling !== null && previes_sibling?.classList?.contains(ICON_CLASS)) {
            return false;
        }
        let previous_txt = previes_sibling?.innerText;
        if (isUnicodeEmoji(previous_txt)) {
            return true;
        }

        // let block_id = element.attributes["data-id"].value;
        let result = await queryDocIcon(block_id);
        if (result === null) {
            return false;
        }
        //思源有可能把 icon 的 span 元素保留了下来, 所以如果发现前面的 element 就是 icon, 就不需要再次插入
        if (result.type === 'unicode' && result.code === previous_txt?.trim()) {
            previes_sibling.classList.add(ICON_CLASS);
            return true;
        }
        element.insertAdjacentHTML('beforebegin', result.dom);
        return true;
    }
}
