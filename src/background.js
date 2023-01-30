import Settings from './lib/settings.js';
import writeUsingContentScript from './lib/clipboard-access.js';
import Markdown from './lib/markdown.js';
import { asyncTabsQuery } from './lib/hacks.js';

const COLOR_GREEN = '#738a05';
const COLOR_RED = '#d11b24';
const COLOR_OPAQUE = [0, 0, 0, 255];

const TEXT_OK = '✓';
const TEXT_ERROR = '×';
const TEXT_EMPTY = '';

const FLASH_BADGE_TIMEOUT = 3000; // ms

async function flashBadge(type) {
    const entrypoint = chrome.action /* MV3 */ || chrome.browserAction; /* Firefox MV2 */

    switch (type) {
        case 'success':
            await entrypoint.setBadgeText({ text: TEXT_OK });
            await entrypoint.setBadgeBackgroundColor({ color: COLOR_GREEN });
            break;
        case 'fail':
            await entrypoint.setBadgeText({ text: TEXT_ERROR });
            await entrypoint.setBadgeBackgroundColor({ color: COLOR_RED });
            break;
        default:
            return; // don't know what it is. quit.
    }

    chrome.alarms.create('clear', { when: Date.now() + FLASH_BADGE_TIMEOUT });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    const entrypoint = chrome.action /* MV3 */ || chrome.browserAction; /* Firefox MV2 */

    if (alarm.name === 'clear') {
        Promise.all([
                entrypoint.setBadgeText({ text: TEXT_EMPTY }),
                entrypoint.setBadgeBackgroundColor({ color: COLOR_OPAQUE }),
            ])
            .then(() => { /* NOP */ });
    }
});

async function handleContentOfContextMenu(info, tab) {
    const markdown = new Markdown({});

    try {
        markdown.alwaysEscapeLinkBracket = await Settings.getLinkTextAlwaysEscapeBrackets();
    } catch (error) {
        console.error(error);
    }

    let text;
    switch (info.menuItemId) {
        case 'current-page':
            {
                text = markdown.linkTo(tab.title, tab.url);
                break;
            }

        case 'link':
            {
                /* <a href="linkURL"><img src="srcURL" /></a> */
                if (info.mediaType === 'image') {
                    // TODO: extract image alt text
                    text = Markdown.linkedImage('', info.srcUrl, info.linkUrl);
                    break;
                }

                /* <a href="linkURL">Text</a> */

                // linkText for Firefox (as of 2018/03/07)
                // selectionText for Chrome on Mac only. On Windows it does not highlight text when
                // right-click.
                // TODO: use linkText when Chrome supports it on stable.
                const linkText = info.selectionText || info.linkText;

                text = markdown.linkTo(linkText, info.linkUrl);
                break;
            }

        case 'image':
            {
                // TODO: extract image alt text
                text = Markdown.imageFor('', info.srcUrl);
                break;
            }

        default:
            {
                throw new TypeError(`unknown context menu: ${info}`);
            }
    }
    return text;
}

async function handleExport(action) {
    const markdown = new Markdown({});

    try {
        markdown.alwaysEscapeLinkBracket = await Settings.getLinkTextAlwaysEscapeBrackets();
    } catch (error) {
        console.error(error);
    }

    switch (action) {
        case 'current-tab-link':
            {
                const tabs = await asyncTabsQuery({ currentWindow: true, active: true });
                if (tabs.length !== 1) {
                    throw new Error(`Expecting exactly 1 tab, got ${tabs.length} items.`);
                }

                function removeNonUTF8Chars(str) {
                    return str.replace(/[^\u4e00-\u9fa5\u3002\uff1f\uff01\uff0c\u3001\uff1b\uff1a\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b\u3008\u3009\u3010\u3011\u300e\u300f\u300c\u300d\ufe43\ufe44\u3014\u3015\u2026\u2014\uff5e\ufe4f\uffe5\u0020-\u007E\u00A0-\u00FF]+/g, "");
                }

                const onlyOneTab = tabs[0];
                var title = onlyOneTab.title;
                // title = title.replace(/[\u200B-\u200D\uFEFF\u2060\u2028\u2029\u202C]+/g, '');
                var text = title;
                var newText = removeNonUTF8Chars(text);
                // for (var i = 0; i < text.length; i++) {
                //     var charCode = text.charCodeAt(i);
                //     if (charCode >= 0 && charCode <= 127 || (charCode >= 0x4e00 && charCode <= 0x9fff)) {
                //         newText += text[i];
                //     }
                // }
                return markdown.linkTo(newText, onlyOneTab.url);
            }

        case 'all-tabs-link-as-list':
            {
                const tabs = await asyncTabsQuery({ currentWindow: true });
                return markdown.links(tabs, {});
            }

        case 'all-tabs-title-as-list':
            {
                const tabs = await asyncTabsQuery({ currentWindow: true });
                return Markdown.list(tabs.map((tab) => tab.title));
            }

        case 'all-tabs-url-as-list':
            {
                const tabs = await asyncTabsQuery({ currentWindow: true });
                return Markdown.list(tabs.map((tab) => tab.url));
            }

        case 'highlighted-tabs-link-as-list':
            {
                const tabs = await asyncTabsQuery({ currentWindow: true, highlighted: true });
                return markdown.links(tabs, {});
            }

        case 'highlighted-tabs-title-as-list':
            {
                const tabs = await asyncTabsQuery({ currentWindow: true, highlighted: true });
                return Markdown.list(tabs.map((tab) => tab.title));
            }

        case 'highlighted-tabs-url-as-list':
            {
                const tabs = await asyncTabsQuery({ currentWindow: true, highlighted: true });
                return Markdown.list(tabs.map((tab) => tab.url));
            }

        default:
            {
                throw new TypeError(`Unknown action: ${action}`);
            }
    }
}

async function mustGetCurrentTab() {
    const tabs = await asyncTabsQuery({ currentWindow: true, active: true });
    if (tabs.length !== 1) {
        return Promise.reject(new Error('failed to get current tab'));
    }

    return Promise.resolve(tabs[0]);
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'current-page',
        title: 'Copy [Page Title](URL)',
        type: 'normal',
        contexts: ['page'],
    });

    chrome.contextMenus.create({
        id: 'link',
        title: 'Copy [Link Content](URL)',
        type: 'normal',
        contexts: ['link'],
    });

    chrome.contextMenus.create({
        id: 'image',
        title: 'Copy ![](Image URL)', // TODO: how to fetch alt text?
        type: 'normal',
        contexts: ['image'],
    });
});

// NOTE: All listeners must be registered at top level scope.

chrome.contextMenus.onClicked.addListener(async(info, tab) => {
    try {
        const text = await handleContentOfContextMenu(info, tab);
        await writeUsingContentScript(tab, text);
        await flashBadge('success');
        return Promise.resolve(true);
    } catch (error) {
        console.error(error);
        await flashBadge('fail');
        return Promise.reject(error);
    }
});

// listen to keyboard shortcuts
chrome.commands.onCommand.addListener(async(command) => {
    try {
        const tab = await mustGetCurrentTab();
        const text = await handleExport(command);
        await writeUsingContentScript(tab, text);
        await flashBadge('success');
        return Promise.resolve(true);
    } catch (e) {
        console.error(e);
        await flashBadge('fail');
        return Promise.reject(e);
    }
});

// listen to messages from popup
// NOTE: async function will not work here
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.topic) {
        case 'badge':
            {
                flashBadge(message.params.type)
                .then(() => {
                    sendResponse({ ok: true });
                }, (error) => {
                    sendResponse({ ok: false, error });
                });
                break;
            }

        case 'export':
            {
                handleExport(message.params.action)
                .then((text) => {
                    sendResponse({ ok: true, text });
                }, (error) => {
                    sendResponse({ ok: false, error });
                });
                break;
            }

        default:
            {
                throw TypeError(`Unknown message topic '${message.topic}'`);
            }
    }

    // Must return true to indicate async. See https://developer.chrome.com/docs/extensions/mv3/messaging/#simple
    return true;
});