<template>
  <div class="platform-icon" :title="domain">
    <img v-if="iconSrc" :src="iconSrc" :alt="domain" />
    <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fallback-icon">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      <path d="M2 12h20"/>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import bilibiliSvg from '../assets/platform/bilibili.svg';
import bytedanceSvg from '../assets/platform/bytedance.svg';
import tencentSvg from '../assets/platform/tencent.svg';
import metaSvg from '../assets/platform/meta.svg';
import youtubeSvg from '../assets/platform/youtube.svg';
import xSvg from '../assets/platform/x.svg';

const { url } = defineProps<{
  url: string;
}>();

const domain = computed(() => {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
});

const iconSrc = computed(() => {
  const d = domain.value;
  if (!d || d === 'unknown') return null;
  
  if (d.includes('bilibili.com') || d.includes('b23.tv')) return bilibiliSvg;
  if (d.includes('douyin.com') || d.includes('tiktok.com') || d.includes('iesdouyin.com')) return bytedanceSvg;
  if (d.includes('v.qq.com') || d.includes('tencent.com')) return tencentSvg;
  if (d.includes('youtube.com') || d.includes('youtu.be')) return youtubeSvg;
  if (d.includes('facebook.com') || d.includes('instagram.com') || d.includes('fb.watch')) return metaSvg;
  if (d.includes('twitter.com') || d.includes('x.com')) return xSvg;
  
  return null;
});
</script>

<style scoped>
.platform-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
}

.platform-icon img,
.platform-icon svg {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* 针对部分全黑色的 SVG，在暗黑模式下可以选择性反转。
   如果 lobe-icons 是多彩的则不需要，但为了防患部分单色图标看不清，可以加小幅度滤镜 */
:root[data-theme="dark"] .platform-icon img,
:root[data-theme="midnight"] .platform-icon img {
  /* Using CSS variable fallback. We can define --platform-icon-filter in styles.css if needed */
  filter: var(--platform-icon-filter, none);
}
</style>
