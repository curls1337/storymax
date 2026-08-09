// Background Service Worker for Chrome Extension
console.log('🤖 [Storymax Bridge] Background Service Worker Started');

chrome.runtime.onInstalled.addListener(() => {
  console.log('✅ [Storymax Bridge] Extension Installed Successfully!');
});
