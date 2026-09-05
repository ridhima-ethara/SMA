// Pixel-faithful platform mockups driven by the live caption + rendered media.
import { Bookmark, ChevronRight, Heart, MessageCircle, Repeat2, Send, Share2, ThumbsUp, BarChart2, BadgeCheck, Globe } from 'lucide-react'
import { BRAND } from '../../shared/brand-voice'
import type { MediaAsset, Platform } from '../types'
import { Logo, Roundel } from './logo'

export function GradientMedia({ ratio = '1.91 / 1', className = '' }: { ratio?: string; className?: string }) {
  return <div className={`grid place-items-center bg-gradient-to-br from-[#0b0e14] via-[#1a1130] to-[#5E1BC7] ${className}`} style={{ aspectRatio: ratio }}><Logo size={40} /></div>
}
function Media({ media, ratio, className = '' }: { media?: MediaAsset | null; ratio: string; className?: string }) {
  if (!media) return <GradientMedia ratio={ratio} className={className} />
  return <img src={media.dataUri} alt={media.altText ?? ''} className={`w-full object-cover ${className}`} style={{ aspectRatio: ratio }} />
}
function Body({ text, tint, limit, className = '' }: { text: string; tint: string; limit?: number; className?: string }) {
  const t = limit && text.length > limit ? `${text.slice(0, limit).replace(/\s\S*$/, '')}… more` : text
  return <p className={`whitespace-pre-wrap break-words text-[13px] leading-snug ${className}`}>{t.split(/(#[\p{L}\p{N}_]+)/gu).map((part, i) => (part.startsWith('#') ? <span key={i} style={{ color: tint }}>{part}</span> : <span key={i}>{part}</span>))}</p>
}

export function LinkedInPreview({ caption, media }: { caption: string; media?: MediaAsset | null }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e0dfdc] bg-white text-[#191919] shadow-sm font-sans">
      <div className="flex items-start gap-2.5 px-4 pt-3 pb-2"><Roundel size={48} /><div className="min-w-0 leading-tight"><div className="text-sm font-semibold">{BRAND.handles.linkedin}</div><div className="truncate text-xs text-[#666]">{BRAND.tagline} · {BRAND.followers.toLocaleString()} followers</div><div className="flex items-center gap-1 text-xs text-[#666]">Just now · <Globe size={11} /></div></div></div>
      <div className="px-4 pb-3"><Body text={caption} tint="#0a66c2" limit={420} /></div>
      <Media media={media} ratio="1.91 / 1" />
      <div className="flex items-center justify-between px-4 py-2 text-xs text-[#666]"><span className="inline-flex items-center gap-1"><span className="inline-flex"><span className="grid h-4 w-4 place-items-center rounded-full bg-[#0a66c2] text-white"><ThumbsUp size={9} /></span><span className="-ml-1 grid h-4 w-4 place-items-center rounded-full bg-[#df704d] text-white"><Heart size={9} /></span></span> 247</span><span>38 comments · 12 reposts</span></div>
      <div className="grid grid-cols-4 border-t border-[#e0dfdc] text-xs font-semibold text-[#666]">{[['Like', ThumbsUp], ['Comment', MessageCircle], ['Repost', Repeat2], ['Send', Send]].map(([l, I]) => { const Icon = I as typeof ThumbsUp; return <div key={String(l)} className="flex items-center justify-center gap-1.5 py-2.5"><Icon size={15} />{String(l)}</div> })}</div>
    </div>
  )
}

export function InstagramPreview({ caption, media }: { caption: string; media?: MediaAsset | null }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#dbdbdb] bg-white text-[#262626] shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5"><div className="rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[2px]"><div className="rounded-full ring-2 ring-white"><Roundel size={32} /></div></div><div className="text-sm font-semibold">{BRAND.handles.instagram}</div><div className="ml-auto text-lg leading-none">···</div></div>
      <div className="relative"><Media media={media} ratio="4 / 5" /><div className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full bg-white/80 text-[#262626]"><ChevronRight size={16} /></div><div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">{[0, 1, 2, 3, 4].map((i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-[#0095f6]' : 'bg-white/70'}`} />)}</div></div>
      <div className="flex items-center gap-4 px-3 py-2.5"><Heart size={22} /><MessageCircle size={22} /><Send size={22} /><Bookmark size={22} className="ml-auto" /></div>
      <div className="px-3 pb-3"><div className="text-sm font-semibold">312 likes</div><div className="mt-1"><span className="mr-1.5 text-[13px] font-semibold">{BRAND.handles.instagram}</span><Body text={caption} tint="#00376b" limit={220} className="inline" /></div></div>
    </div>
  )
}

export function XPreview({ caption, media }: { caption: string; media?: MediaAsset | null }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#2f3336] bg-black p-4 text-[#e7e9ea]">
      <div className="flex gap-3"><div className="shrink-0 rounded-full ring-1 ring-[#2f3336]"><Roundel size={40} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-sm"><span className="font-bold">{BRAND.handles.linkedin}</span><BadgeCheck size={15} className="text-[#1d9bf0]" /><span className="text-[#71767b]">{BRAND.handles.x} · now</span></div><div className="mt-1"><Body text={caption} tint="#1d9bf0" /></div>{media && <div className="mt-3 overflow-hidden rounded-2xl border border-[#2f3336]"><Media media={media} ratio="16 / 9" /></div>}<div className="mt-3 flex justify-between text-xs text-[#71767b] max-w-md"><span className="inline-flex items-center gap-1.5"><MessageCircle size={15} />18</span><span className="inline-flex items-center gap-1.5"><Repeat2 size={15} />42</span><span className="inline-flex items-center gap-1.5"><Heart size={15} />156</span><span className="inline-flex items-center gap-1.5"><BarChart2 size={15} />12.4K</span><Share2 size={15} /></div></div></div>
    </div>
  )
}

export function PlatformPreview({ platform, caption, media }: { platform: Platform; caption: string; media?: MediaAsset | null }) {
  if (platform === 'linkedin') return <LinkedInPreview caption={caption} media={media} />
  if (platform === 'instagram') return <InstagramPreview caption={caption} media={media} />
  return <XPreview caption={caption} media={media} />
}
