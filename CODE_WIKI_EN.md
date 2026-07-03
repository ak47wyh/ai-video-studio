[中文](./CODE_WIKI.md) | English

# AI Video Studio — Code Wiki

> Last updated: June 19, 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Project Architecture](#3-project-architecture)
4. [Directory Structure](#4-directory-structure)
5. [Domain Entities](#5-domain-entities)
6. [Domain Ports](#6-domain-ports)
7. [Domain Services](#7-domain-services)
8. [Adapters](#8-adapters)
9. [Dependency Injection Container (Dependencies)](#9-dependency-injection-container-dependencies)
10. [UI Layer (Presentation)](#10-ui-layer-presentation)
11. [Routes & Pages](#11-routes--pages)
12. [Internationalization (i18n)](#12-internationalization-i18n)
13. [Data Persistence (IndexedDB)](#13-data-persistence-indexeddb)
14. [Utilities & Infrastructure](#14-utilities--infrastructure)
15. [Core Business Flows](#15-core-business-flows)
16. [How to Run the Project](#16-how-to-run-the-project)

---

## 1. Project Overview

**AI Video Studio** is a React + TypeScript based AI short video creation platform. Users can input story text via natural language, and AI automatically performs character extraction, scene splitting, image/video/voiceover/BGM generation, and finally composes a complete short video through FFmpeg post-processing.

### Core Capabilities

| Capability | Description |
|------------|-------------|
| Story Creation | Input story text, AI automatically splits into storyboards, extracts characters and scenes |
| Image Generation | Generate character/scene images based on MiniMax Image API |
| Video Generation | Support T2V / I2V / FL2V / S2V multiple video generation modes |
| Voice Synthesis | Support voice cloning, voice design, streaming synthesis |
| Music Generation | AI-generated background music, lyrics creation, cover songs |
| Text Enhancement | AI text enhancement and rewriting |
| Post-Processing | FFmpeg WASM for video concatenation, subtitle burning, audio mixing |
| One-Click Production | Pipeline full-process orchestration, from story to final video automatically |
| AI Assistant | Agent conversational creation assistant |

---

## 2. Tech Stack & Dependencies

### Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `react` / `react-dom` | ^19.2.6 | UI framework |
| `react-router-dom` | ^7.17.0 | Client-side routing |
| `axios` | ^1.17.0 | HTTP requests |
| `dexie` / `dexie-react-hooks` | ^4.4.3 | IndexedDB ORM |
| `@ffmpeg/ffmpeg` / `@ffmpeg/util` | ^0.12.15 | Browser-side video processing (WASM) |
| `i18next` / `react-i18next` / `i18next-browser-languagedetector` | ^26.3.1 | Internationalization |
| `lucide-react` | ^1.17.0 | Icon library |
| `uuid` | ^14.0.0 | UUID generation |

### Dev Dependencies

| Dependency | Purpose |
|------------|---------|
| `vite` | Build tool |
| `typescript` ~6.0.2 | Type system |
| `@vitejs/plugin-react` | React Vite plugin |
| `eslint` + plugins | Code linting |

### External API Services

| Service | Base URL | Purpose |
|---------|----------|---------|
| MiniMax API | `https://api.minimaxi.com/v1` | Text/Image/Video/Voice/Music/Model/File |
| MiniMax Anthropic Compatible Endpoint | `https://api.minimaxi.com/anthropic` | Text generation (Anthropic protocol) |
| FFmpeg WASM | Local browser | Video post-processing |
| Whisper | Local/Remote | Speech-to-text |

---

## 3. Project Architecture

This project adopts the **Hexagonal Architecture (Ports & Adapters)** pattern, completely decoupling business logic from external dependencies:

```
┌─────────────────────────────────────────────────────────┐
│                      UI Layer (React)                    │
│   Pages / Components / Hooks / Contexts / Layouts       │
├─────────────────────────────────────────────────────────┤
│                  Dependency Injection                     │
│                  (dependencies.ts)                        │
├─────────────────────────────────────────────────────────┤
│                  Domain Services                         │
│  StoryService / VideoGenerationService / PipelineService │
│  VoiceService / MusicService / AgentService ...          │
├─────────────────────────────────────────────────────────┤
│                  Domain Ports (Interfaces)                │
│  IVideoGeneratorPort / IImageGeneratorPort / IVoicePort  │
│  IMusicPort / ITextGenerationPort / IFFmpegPort ...      │
├─────────────────────────────────────────────────────────┤
│                  Domain Entities                          │
│  Story / StorySegment / Character / Background / VideoTask│
├─────────────────────────────────────────────────────────┤
│                  Adapters (Implementations)               │
│  MiniMaxVideoAdapter / MiniMaxImageAdapter / ...          │
│  FFmpegAdapter / WhisperAdapter / IndexedDBAdapters       │
└─────────────────────────────────────────────────────────┘
```

### Architecture Principles

1. **Dependency Inversion**: Domain services only depend on Port interfaces, not on concrete adapter implementations
2. **Separation of Concerns**: UI → Domain → Adapters, three layers clearly isolated
3. **Replaceability**: Any adapter can be replaced (e.g., Mock adapters for testing/degradation)
4. **Smart Degradation**: `smartTextSplitter` / `smartStoryBreakdown` automatically fall back to Mock when AI is unavailable

---

## 4. Directory Structure

```
src/
├── adapters/                    # Adapter layer — external system implementations
│   └── outbound/
│       ├── api/                 # External API adapters
│       │   ├── MiniMaxVideoAdapter.ts
│       │   ├── MiniMaxImageAdapter.ts
│       │   ├── MiniMaxVoiceAdapter.ts
│       │   ├── MiniMaxMusicAdapter.ts
│       │   ├── MiniMaxTextAdapter.ts
│       │   ├── MiniMaxTextSplitterAdapter.ts
│       │   ├── MiniMaxStoryBreakdownAdapter.ts
│       │   ├── MiniMaxModelAdapter.ts
│       │   ├── MiniMaxFileAdapter.ts
│       │   ├── MiniMaxErrorUtils.ts
│       │   ├── FFmpegAdapter.ts
│       │   ├── WhisperAdapter.ts
│       │   ├── MockTextSplitter.ts
│       │   └── MockStoryBreakdown.ts
│       ├── config/
│       │   └── ApiConfigStore.ts
│       └── repositories/
│           ├── DexieDatabase.ts
│           ├── IndexedDBAdapters.ts
│           └── AssetLibraryRepositories.ts
├── domain/                      # Domain layer — core business logic
│   ├── data/
│   │   └── systemVoices.ts
│   ├── entities/
│   │   └── models.ts
│   ├── ports/
│   │   ├── OutboundPorts.ts
│   │   ├── AssetLibraryPorts.ts
│   │   └── PostProcessPorts.ts
│   └── services/
│       ├── AgentService.ts
│       ├── AssetLibraryService.ts
│       ├── AutoEditService.ts
│       ├── BGMRecommendationService.ts
│       ├── CinematographyService.ts
│       ├── FileManagementService.ts
│       ├── ImageGenerationService.ts
│       ├── ModelManagementService.ts
│       ├── MusicLabService.ts
│       ├── MusicService.ts
│       ├── PipelineService.ts
│       ├── PostProcessService.ts
│       ├── SnapshotService.ts
│       ├── StoryService.ts
│       ├── StorySpaceService.ts
│       ├── SubtitleService.ts
│       ├── TextGenerationService.ts
│       ├── TextLabService.ts
│       ├── VideoGenerationService.ts
│       ├── VideoLabService.ts
│       └── VoiceService.ts
├── ui/                          # UI presentation layer
│   ├── components/              # Common components
│   ├── contexts/                # React Context
│   ├── hooks/                   # Custom Hooks
│   ├── layouts/                 # Layout components
│   ├── pages/                   # Page components
│   └── utils/                   # UI utility functions
├── utils/                       # General utilities
│   ├── offlineCache.ts
│   ├── cacheMonitor.ts
│   └── retryUtils.ts
├── locales/                     # i18n translation files
│   ├── en/ zh/ ja/ ko/ es/ fr/ de/ ru/ pt/ it/
├── assets/                      # Static assets
├── App.tsx                      # App entry & route definitions
├── dependencies.ts              # Dependency injection container
├── i18n.ts                      # i18n configuration
├── main.tsx                     # Render entry
└── index.css                    # Global styles
```

---

## 5. Domain Entities

File: [models.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/entities/models.ts)

### Core Entities

| Entity | Description | Key Fields |
|--------|-------------|------------|
| `StorySpace` | Creative space, isolating data for different projects | `id`, `name`, `description` |
| `Character` | Character, belonging to a space | `id`, `spaceId`, `name`, `appearancePrompt`, `personalityPrompt`, `referenceImageUrl?`, `voiceId?` |
| `Background` | Scene background, belonging to a space | `id`, `spaceId`, `name`, `environmentPrompt`, `referenceImageUrl?` |
| `Story` | Story, belonging to a space | `id`, `spaceId`, `title`, `originalText`, `status` (DRAFT/SPLIT) |
| `StorySegment` | Story storyboard segment | `id`, `storyId`, `sequenceOrder`, `content`, `mentionedCharacters[]`, `selectedBackgroundId?`, `bgmAudioUrl?`, `firstFrameImage?` |
| `VideoTask` | Video generation task | `id`, `segmentId`, `status` (PENDING/PROCESSING/SUCCESS/FAILED), `externalTaskId`, `mode`, `model`, `resolution`, `duration` |
| `PipelineTask` | Pipeline task | `id`, `storyId`, `status`, `progress`, `steps[]`, `finalVideoUrl?` |
| `PipelineStep` | Pipeline step | `name`, `status` (pending/running/done/failed), `error?` |
| `FinalCut` | Final production | `id`, `storyId`, `videoBlob`, `thumbnailUrl?`, `duration`, `hasSubtitles`, `srtContent?` |

### Asset Library Entities (v8)

| Entity | Description | Key Fields |
|--------|-------------|------------|
| `SavedImage` | Saved image | `id`, `spaceId`, `prompt`, `model`, `blobKey`, `sourceType` (lab/pipeline/character/background) |
| `SavedVoice` | Saved voice | `id`, `spaceId`, `voiceId`, `audioBlobKey`, `sourceType` (lab/clone/pipeline) |
| `SavedPrompt` | Saved prompt | `id`, `spaceId`, `content`, `category` (image/voice/story/scene/narration/other) |

### Key Enums/Types

| Type | Values |
|------|--------|
| `StoryStatus` | `'DRAFT'` \| `'SPLIT'` |
| `VideoTaskStatus` | `'PENDING'` \| `'PROCESSING'` \| `'SUCCESS'` \| `'FAILED'` |
| `VideoModel` | `'MiniMax-Hailuo-2.3'` \| `'MiniMax-Hailuo-02'` \| `'T2V-01-Director'` \| `'T2V-01'` \| `'S2V-01'` |
| `VideoResolution` | `'720P'` \| `'768P'` \| `'1080P'` |
| `VideoGenerationMode` | `'t2v'` \| `'i2v'` \| `'fl2v'` \| `'s2v'` |
| `PipelineStatus` | `'idle'` \| `'splitting'` \| `'generating_images'` \| `'generating_audio'` \| `'generating_bgm'` \| `'generating_videos'` \| `'post_processing'` \| `'generating_srt'` \| `'burning_subtitles'` \| `'complete'` \| `'failed'` |

---

## 6. Domain Ports

### OutboundPorts.ts

File: [OutboundPorts.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/ports/OutboundPorts.ts)

Defines all outbound port interfaces, which are the contracts for the domain layer to interact with external systems:

#### Repository Ports

| Interface | Methods | Description |
|-----------|---------|-------------|
| `IStorySpaceRepository` | `save`, `findById`, `findAll`, `delete` | Creative space CRUD |
| `ICharacterRepository` | `save`, `findById`, `findAll`, `findBySpaceId`, `delete` | Character CRUD |
| `IBackgroundRepository` | `save`, `findById`, `findAll`, `findBySpaceId`, `delete` | Background CRUD |
| `IStoryRepository` | `save`, `findById`, `findAll`, `findBySpaceId`, `delete` | Story CRUD |
| `IStorySegmentRepository` | `save`, `findById`, `findByStoryId`, `deleteByStoryId` | Storyboard segment CRUD |
| `IVideoTaskRepository` | `save`, `findBySegmentId`, `findLatestBySegmentId`, `findByStatuses`, `updateStatus`, `deleteBySegmentIds` | Video task management |
| `IFinalCutRepository` | `save`, `findById`, `findByStoryIds`, `delete` | Final production management |

#### External Service Ports (API Ports)

| Interface | Key Methods | Description |
|-----------|-------------|-------------|
| `IVideoGeneratorPort` | `submitVideoTask`, `queryTaskStatus`, `downloadVideo`, `createAgentTask`, `queryAgentTask` | Video generation |
| `IImageGeneratorPort` | `generateImage` | Image generation |
| `IVoicePort` | `uploadFile`, `cloneVoice`, `createT2ATask`, `queryT2ATask`, `synthesizeSpeechSync`, `synthesizeSpeechStream`, `designVoice`, `getAvailableVoices`, `deleteVoice`, `fetchAudioAsBlobUrl` | Voice synthesis |
| `IMusicPort` | `generateMusic`, `generateLyrics`, `preprocessCover` | Music generation |
| `ITextGenerationPort` | `chatCompletion`, `chatCompletionStream` | Text generation |
| `IModelManagementPort` | `listModels`, `retrieveModel` | Model management |
| `IFileManagementPort` | `listFiles`, `deleteFile` | File management |
| `ITextSplitterPort` | `splitStoryToSegments` | Story splitting |
| `IStoryBreakdownPort` | `breakdownStory` | One-click breakdown |

### PostProcessPorts.ts

File: [PostProcessPorts.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/ports/PostProcessPorts.ts)

| Interface | Key Methods | Description |
|-----------|-------------|-------------|
| `IFFmpegPort` | `load`, `merge`, `concat`, `burnSubtitles`, `mixAudio`, `applyTransition`, `compress`, `convertFormat`, `changeSpeed`, `trim`, `crop`, `resize`, `extractFrame`, `reverse`, `fadeInOut` | FFmpeg post-processing |
| `IWhisperPort` | `load`, `transcribe` | Speech-to-text |

### AssetLibraryPorts.ts

File: [AssetLibraryPorts.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/ports/AssetLibraryPorts.ts)

| Interface | Methods | Description |
|-----------|---------|-------------|
| `ISavedImageRepository` | `save`, `getById`, `query`, `delete`, `count` | Image asset library |
| `ISavedVoiceRepository` | `save`, `getById`, `query`, `delete`, `count` | Voice asset library |
| `ISavedPromptRepository` | `save`, `getById`, `query`, `delete`, `count` | Prompt asset library |

---

## 7. Domain Services

### 7.1 Creative Domain Services

#### StoryService

File: [StoryService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/StoryService.ts)

**Dependencies**: `IStoryRepository`, `IStorySegmentRepository`, `ICharacterRepository`, `IBackgroundRepository`, `ITextSplitterPort`, `IStoryBreakdownPort`, `IVideoTaskRepository`

| Method | Signature | Description |
|--------|-----------|-------------|
| `createStory` | `(title, originalText, spaceId) => Promise<Story>` | Create a story |
| `updateStory` | `(storyId, title, originalText) => Promise<void>` | Update a story (resets to DRAFT when content changes) |
| `splitStory` | `(storyId) => Promise<StorySegment[]>` | AI split story into storyboard segments |
| `previewBreakdown` | `(storyId) => Promise<StoryBreakdownResult>` | Preview one-click breakdown result (without saving) |
| `applyBreakdown` | `(storyId, characters, backgrounds, segments) => Promise<{savedCharacterIds, savedBackgroundIds}>` | Apply one-click breakdown (save characters/backgrounds/segments, deduplicate by name) |
| `getSegments` | `(storyId) => Promise<StorySegment[]>` | Get story segments (ordered by sequence) |
| `updateSegmentBackground` | `(segmentId, backgroundId) => Promise<void>` | Update segment background |
| `removeCharacterFromSegments` | `(characterId) => Promise<void>` | Remove character reference from all segments |
| `removeBackgroundFromSegments` | `(backgroundId) => Promise<void>` | Remove background reference from all segments |
| `deleteStory` | `(storyId) => Promise<void>` | Delete story and its segments and video tasks |
| `getAllStories` | `() => Promise<Story[]>` | Get all stories |

#### ImageGenerationService

File: [ImageGenerationService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/ImageGenerationService.ts)

**Dependencies**: `IImageGeneratorPort`, `ICharacterRepository`, `IBackgroundRepository`

| Method | Description |
|--------|-------------|
| `generateCharacterImage` | Generate character image based on character appearance description |
| `generateBackgroundImage` | Generate background image based on scene environment description |

#### TextGenerationService

File: [TextGenerationService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/TextGenerationService.ts)

**Dependencies**: `ITextGenerationPort`

| Method | Description |
|--------|-------------|
| `generate` | General text generation |

#### TextLabService

File: [TextLabService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/TextLabService.ts)

**Dependencies**: `ITextGenerationPort`

| Method | Description |
|--------|-------------|
| `enhanceText` | Text enhancement and polishing |
| `annotateText` | Text annotation |

### 7.2 Audio/Video Domain Services

#### VideoGenerationService

File: [VideoGenerationService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/VideoGenerationService.ts)

**Dependencies**: `IVideoTaskRepository`, `IStorySegmentRepository`, `ICharacterRepository`, `IBackgroundRepository`, `IVideoGeneratorPort`

| Method | Signature | Description |
|--------|-----------|-------------|
| `generateVideo` | `(segmentId, storyId, targetPlatform?, options?) => Promise<VideoTask>` | Submit video generation task, auto-build Prompt context |
| `getLatestTaskForSegment` | `(segmentId) => Promise<VideoTask \| null>` | Get latest video task for a segment |
| `resumeActivePolling` | `() => Promise<void>` | Resume polling for active tasks after page reload |
| `cancelAllPolling` | `() => void` | Cancel all polling (called on app unmount) |

**Internal Mechanism**:
- Asynchronously polls status after task submission (3s interval, max 60 times)
- Supports T2V / I2V / FL2V / S2V four modes
- Automatically builds video Prompt based on characters/backgrounds

#### VideoLabService

File: [VideoLabService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/VideoLabService.ts)

**Dependencies**: `IVideoGeneratorPort`

| Method | Description |
|--------|-------------|
| `generateVideo` | Lab mode video generation |
| `queryTaskStatus` | Query video task status |

#### VoiceService

File: [VoiceService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/VoiceService.ts)

**Dependencies**: `IVoicePort`, `ICharacterRepository`

| Method | Description |
|--------|-------------|
| `generateNarration` | Generate narration based on character voice |
| `cloneVoice` | Voice cloning |
| `synthesizeSpeech` | Speech synthesis |

#### MusicService

File: [MusicService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/MusicService.ts)

**Dependencies**: `IMusicPort`, `IStorySegmentRepository`

| Method | Description |
|--------|-------------|
| `generateBGM` | Generate background music for a segment |
| `generateLyrics` | AI lyrics creation |
| `generateCoverMusic` | Cover music generation |

#### MusicLabService

File: [MusicLabService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/MusicLabService.ts)

**Dependencies**: `IMusicPort`

| Method | Description |
|--------|-------------|
| `generateMusic` | Lab mode music generation |
| `parseAudioUrl` | Parse audio URL |

### 7.3 Post-Processing Services

#### PostProcessService

File: [PostProcessService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/PostProcessService.ts)

**Dependencies**: `IFFmpegPort`, `IWhisperPort`

| Method | Description |
|--------|-------------|
| `ensureLoaded` | Load FFmpeg WASM |
| `isFFmpegLoaded` | Check if FFmpeg is loaded |
| `mergeVideoAudio` | Merge video and audio |
| `concatClips` | Concatenate multiple video clips |
| `burnSubtitles` | Burn subtitles |
| `mixAudio` | Mix audio tracks |

#### SubtitleService

File: [SubtitleService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/SubtitleService.ts)

**Dependencies**: `IWhisperPort`, `ITextGenerationPort`

| Method | Description |
|--------|-------------|
| `generateSrtFromSegments` | Generate SRT subtitles from segments |
| `transcribeAudio` | Speech-to-text |

### 7.4 Pipeline Service

#### PipelineService

File: [PipelineService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/PipelineService.ts)

**Dependencies**: `IStoryRepository`, `IStorySegmentRepository`, `ICharacterRepository`, `IBackgroundRepository`, `IVideoTaskRepository`, `IFinalCutRepository`, `ITextGenerationPort`, `IImageGeneratorPort`, `IVideoGeneratorPort`, `IVoicePort`, `IMusicPort`, `PostProcessService`, `SubtitleService`

This is the core orchestration service, implementing the full one-click production pipeline:

| Method | Signature | Description |
|--------|-----------|-------------|
| `createTask` | `(storyId) => PipelineTask` | Create a pipeline task |
| `subscribe` | `(taskId, callback) => unsubscribe` | Subscribe to task status changes |
| `getTask` | `(taskId) => PipelineTask \| null` | Get a task |
| `listTasks` | `() => PipelineTask[]` | List all tasks |
| `runFullPipeline` | `(storyId, options?) => Promise<PipelineTask>` | Execute the full pipeline |
| `assembleFinalVideo` | `(storyId, narrationUrls, onProgress?) => Promise<FinalCut>` | Assemble the final video |
| `cancelTask` | `(taskId) => void` | Cancel a task |
| `markComplete` | `(taskId, finalVideoUrl) => void` | Mark as complete |
| `markFailed` | `(taskId, error) => void` | Mark as failed |

**Pipeline Stage Flow**:

```
splitting → generating_images → generating_audio → generating_bgm
→ generating_videos → post_processing → generating_srt → burning_subtitles → complete
```

### 7.5 AI Enhancement Services

#### AgentService

File: [AgentService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/AgentService.ts)

**Dependencies**: `ITextGenerationPort`

| Method | Signature | Description |
|--------|-----------|-------------|
| `chat` | `(messages: AgentMessage[]) => Promise<string>` | AI assistant conversation |
| `suggestActionPlan` | `(userMessage) => Promise<string[]>` | Recommend tool call sequence based on user intent |

Built-in system prompt defines 13 tool capabilities (create characters/backgrounds, split stories, generate video prompts, recommend BGM, etc.).

#### CinematographyService

File: [CinematographyService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/CinematographyService.ts)

**Dependencies**: `ITextGenerationPort`

| Method | Description |
|--------|-------------|
| `suggestShots` | AI shot suggestions |
| `planStoryboard` | Storyboard planning |

#### BGMRecommendationService

File: [BGMRecommendationService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/BGMRecommendationService.ts)

**Dependencies**: `ITextGenerationPort`

| Method | Description |
|--------|-------------|
| `recommendBGM` | AI background music recommendation |
| `buildBGMPrompt` | Build BGM prompt |

#### AutoEditService

File: [AutoEditService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/AutoEditService.ts)

**Dependencies**: `IFFmpegPort`

| Method | Description |
|--------|-------------|
| `detectKeyFrames` | Video keyframe detection |
| `suggestEdits` | Editing suggestions |
| `autoEdit` | Auto editing |

### 7.6 Management Services

#### StorySpaceService

File: [StorySpaceService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/StorySpaceService.ts)

**Dependencies**: `IStorySpaceRepository`, `ICharacterRepository`, `IBackgroundRepository`, `IStoryRepository`, `IStorySegmentRepository`, `IVideoTaskRepository`

| Method | Description |
|--------|-------------|
| `createSpace` | Create a space |
| `deleteSpace` | Delete a space (cascade delete all associated data) |
| `listSpaces` | List all spaces |

#### ModelManagementService

File: [ModelManagementService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/ModelManagementService.ts)

**Dependencies**: `IModelManagementPort`

| Method | Description |
|--------|-------------|
| `getModels` | Get model list (with caching) |
| `getModelInfo` | Get model details |

#### FileManagementService

File: [FileManagementService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/FileManagementService.ts)

**Dependencies**: `IFileManagementPort`

| Method | Description |
|--------|-------------|
| `listFiles` | List files |
| `deleteFile` | Delete a file |

#### AssetLibraryService

File: [AssetLibraryService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/AssetLibraryService.ts)

**Dependencies**: `ISavedImageRepository`, `ISavedVoiceRepository`, `ISavedPromptRepository`

| Method | Description |
|--------|-------------|
| `saveImage` / `queryImages` / `deleteImage` | Image asset management |
| `saveVoice` / `queryVoices` / `deleteVoice` | Voice asset management |
| `savePrompt` / `queryPrompts` / `deletePrompt` | Prompt asset management |

#### SnapshotService

File: [SnapshotService.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/services/SnapshotService.ts)

**Dependencies**: `IStorySegmentRepository`

| Method | Description |
|--------|-------------|
| `createSnapshot` | Create a segment snapshot |
| `restoreSnapshot` | Restore a snapshot |

---

## 8. Adapters

### 8.1 External API Adapters

| Adapter | Implements | API Endpoint | Description |
|---------|------------|--------------|-------------|
| `MiniMaxVideoAdapter` | `IVideoGeneratorPort` | `/v1/video_generation` | Video generation (submit/query/download/Agent tasks) |
| `MiniMaxImageAdapter` | `IImageGeneratorPort` | `/v1/images/generations` | Image generation |
| `MiniMaxVoiceAdapter` | `IVoicePort` | `/v1/audio/speech`, `/v1/t2a_*`, `/v1/voice_clone/*` | Voice synthesis/cloning/design |
| `MiniMaxMusicAdapter` | `IMusicPort` | `/v1/music_generation`, `/v1/lyrics_generation` | Music/lyrics generation |
| `MiniMaxTextAdapter` | `ITextGenerationPort` | `/v1/chat/completions` | Text generation (sync/streaming) |
| `MiniMaxTextSplitterAdapter` | `ITextSplitterPort` | Implemented via `ITextGenerationPort` | AI story splitting (smart degradation) |
| `MiniMaxStoryBreakdownAdapter` | `IStoryBreakdownPort` | Implemented via `ITextGenerationPort` | AI one-click breakdown (smart degradation) |
| `MiniMaxModelAdapter` | `IModelManagementPort` | `/v1/models` | Model list/details |
| `MiniMaxFileAdapter` | `IFileManagementPort` | `/v1/files` | File management |
| `FFmpegAdapter` | `IFFmpegPort` | Local WASM | Browser-side video processing |
| `WhisperAdapter` | `IWhisperPort` | Local/Remote | Speech recognition |

### 8.2 Mock / Degradation Adapters

| Adapter | Implements | Description |
|---------|------------|-------------|
| `MockTextSplitter` | `ITextSplitterPort` | Simple paragraph-based splitting, no AI calls |
| `MockStoryBreakdown` | `IStoryBreakdownPort` | Returns empty characters/backgrounds, simple paragraph-based splitting |

**Smart Degradation Mechanism**: `smartTextSplitter` and `smartStoryBreakdown` prioritize AI adapters and automatically fall back to Mock adapters on failure.

### 8.3 Repository Adapters

| Adapter | Implements | Storage Backend |
|---------|------------|-----------------|
| `StorySpaceRepositoryAdapter` | `IStorySpaceRepository` | IndexedDB (Dexie) |
| `CharacterRepositoryAdapter` | `ICharacterRepository` | IndexedDB (Dexie) |
| `BackgroundRepositoryAdapter` | `IBackgroundRepository` | IndexedDB (Dexie) |
| `StoryRepositoryAdapter` | `IStoryRepository` | IndexedDB (Dexie) |
| `StorySegmentRepositoryAdapter` | `IStorySegmentRepository` | IndexedDB (Dexie) |
| `VideoTaskRepositoryAdapter` | `IVideoTaskRepository` | IndexedDB (Dexie) |
| `FinalCutRepositoryAdapter` | `IFinalCutRepository` | IndexedDB (Dexie) |
| `SavedImageRepository` | `ISavedImageRepository` | IndexedDB (Dexie) |
| `SavedVoiceRepository` | `ISavedVoiceRepository` | IndexedDB (Dexie) |
| `SavedPromptRepository` | `ISavedPromptRepository` | IndexedDB (Dexie) |

### 8.4 Configuration Management

#### ApiConfigStore

File: [ApiConfigStore.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/adapters/outbound/config/ApiConfigStore.ts)

`localStorage`-based API configuration management:

```typescript
interface ApiConfig {
  minimaxApiKey: string;           // MiniMax API Key
  minimaxGroupId: string;          // MiniMax Group ID
  minimaxBaseUrl: string;          // Default: https://api.minimaxi.com/v1
  minimaxAnthropicBaseUrl: string; // Dev environment: /anthropic (Vite proxy)
}
```

| Method | Description |
|--------|-------------|
| `load()` | Load configuration |
| `save(config)` | Save configuration |
| `get(key)` | Get a single configuration item |

---

## 9. Dependency Injection Container (Dependencies)

File: [dependencies.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/dependencies.ts)

This is the application's assembly layer, responsible for instantiating all adapters and services and injecting dependencies:

```
┌─ Repository Instances ─────────────────────────────┐
│ spaceRepo / characterRepo / storyRepo / segmentRepo │
│ backgroundRepo / videoTaskRepo / finalCutRepo       │
├─ Infrastructure Instances ──────────────────────────┤
│ videoAdapter / imageAdapter / voiceAdapter           │
│ musicAdapter / textAdapter / modelAdapter            │
│ fileAdapter / ffmpegAdapter / whisperAdapter         │
├─ Smart Degradation Instances ───────────────────────┤
│ mockTextSplitter / mockStoryBreakdown                │
│ smartTextSplitter = MiniMax + Mock degradation       │
│ smartStoryBreakdown = MiniMax + Mock degradation     │
├─ Creative Domain Services ──────────────────────────┤
│ storyService / imageGenerationService                │
│ textGenerationService / textLabService               │
├─ Audio/Video Domain Services ───────────────────────┤
│ videoGenerationService / videoLabService             │
│ voiceService / musicService / musicLabService        │
│ postProcessService / subtitleService                 │
├─ Pipeline Service ──────────────────────────────────┤
│ pipelineService                                      │
├─ Space Management ──────────────────────────────────┤
│ storySpaceService                                    │
├─ Model/File Management ─────────────────────────────┤
│ modelManagementService / fileManagementService       │
├─ AI Enhancement Services ───────────────────────────┤
│ agentService / autoEditService                       │
│ cinematographyService / bgmRecommendationService     │
├─ Asset Library ─────────────────────────────────────┤
│ savedImageRepo / savedVoiceRepo / savedPromptRepo    │
│ assetLibraryService                                  │
└──────────────────────────────────────────────────────┘
```

---

## 10. UI Layer (Presentation)

### 10.1 Layouts

#### MainLayout

File: [MainLayout.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/layouts/MainLayout.tsx)

Main layout component, including:
- **Collapsible Sidebar**: Logo, space switcher, creation flow indicator, navigation groups
- **Navigation Groups**: Overview, Creation, AI Labs, Management
- **Creation Flow Indicator**: Characters → Scenes → Generate → Export
- **Language Switcher**: Bottom language switcher
- **Main Content Area**: `<Outlet />` renders child routes

### 10.2 React Contexts

| Context | File | Description |
|---------|------|-------------|
| `SpaceContext` | [SpaceContext.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/contexts/SpaceContext.tsx) | Current creative space state, provides `currentSpaceId` / `setCurrentSpaceId` |
| `ToastContext` | [ToastContext.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/contexts/ToastContext.tsx) | Global message notifications, provides `showToast(type, message)` |
| `ConfirmContext` | [ConfirmContext.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/contexts/ConfirmContext.tsx) | Confirmation dialog, provides `confirm(message)` |

### 10.3 Custom Hooks

| Hook | File | Description |
|------|------|-------------|
| `useWorkbenchState` | [useWorkbenchState.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useWorkbenchState.ts) | Workbench global state management |
| `useSpaceScopedQuery` | [useSpaceScopedQuery.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useSpaceScopedQuery.ts) | Space-scoped data query |
| `useVideoTaskPolling` | [useVideoTaskPolling.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useVideoTaskPolling.ts) | Video task polling |
| `usePolling` | [usePolling.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/usePolling.ts) | Generic polling hook |
| `useSavedAssets` | [useSavedAssets.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useSavedAssets.ts) | Saved assets query |
| `useAssetPicker` | [useAssetPicker.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useAssetPicker.ts) | Asset picker |
| `useNetworkStatus` | [useNetworkStatus.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useNetworkStatus.ts) | Network status detection |
| `useSharedForm` | [useSharedForm.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useSharedForm.ts) | Shared form state |
| `useStreamingAudioPlayer` | [useStreamingAudioPlayer.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/hooks/useStreamingAudioPlayer.ts) | Streaming audio playback |

### 10.4 Common Components

| Component | File | Description |
|-----------|------|-------------|
| `AgentChatPanel` | [AgentChatPanel.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/AgentChatPanel.tsx) | AI assistant chat panel, supports streaming responses |
| `PipelinePanel` | [PipelinePanel.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/PipelinePanel.tsx) | Pipeline flow panel, shows progress for each stage |
| `StoryListPanel` | [StoryListPanel.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/StoryListPanel.tsx) | Story list panel |
| `SegmentCard` | [SegmentCard.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/SegmentCard.tsx) | Segment card, displays segment metadata and preview |
| `TimelineEditor` | [TimelineEditor.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/TimelineEditor.tsx) | Timeline editor, drag-and-drop video clip arrangement |
| `VideoTaskCard` | [VideoTaskCard.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/VideoTaskCard.tsx) | Video task card |
| `VideoCompare` | [VideoCompare.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/VideoCompare.tsx) | Video comparison component |
| `BGMPanel` | [BGMPanel.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/BGMPanel.tsx) | BGM selection panel |
| `BreakdownPreview` | [BreakdownPreview.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/BreakdownPreview.tsx) | One-click breakdown preview |
| `CameraDirectivePanel` | [CameraDirectivePanel.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/CameraDirectivePanel.tsx) | Camera directive panel |
| `PostProductionPanel` | [PostProductionPanel.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/PostProductionPanel.tsx) | Post-production panel |
| `ImageGallery` | [ImageGallery.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/ImageGallery.tsx) | Image gallery |
| `ImageUploadField` | [ImageUploadField.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/ImageUploadField.tsx) | Image upload field |
| `ImageAdvancedSettings` | [ImageAdvancedSettings.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/ImageAdvancedSettings.tsx) | Image advanced settings |
| `AudioPreviewPlayer` | [AudioPreviewPlayer.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/AudioPreviewPlayer.tsx) | Audio preview player |
| `AudioUploadField` | [AudioUploadField.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/AudioUploadField.tsx) | Audio upload field |
| `LyricsDisplay` | [LyricsDisplay.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/LyricsDisplay.tsx) | Lyrics display |
| `AssetPicker` | [AssetPicker.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/AssetPicker.tsx) | Asset picker |
| `ThinkingBlock` | [ThinkingBlock.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/ThinkingBlock.tsx) | AI thinking process display |
| `TokenUsageBar` | [TokenUsageBar.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/TokenUsageBar.tsx) | Token usage display |
| `NetworkStatus` | [NetworkStatus.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/NetworkStatus.tsx) | Network status indicator |
| `LanguageSwitcher` | [LanguageSwitcher.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/LanguageSwitcher.tsx) | Language switcher |
| `ErrorBoundary` | [ErrorBoundary.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/ErrorBoundary.tsx) | Error boundary |

---

## 11. Routes & Pages

File: [App.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/App.tsx)

### Route Table

| Path | Page Component | Navigation Group | Description |
|------|---------------|------------------|-------------|
| `/` | `Dashboard` | Overview | Dashboard, project overview |
| `/characters` | `CharacterManagement` | Creation | Character management |
| `/backgrounds` | `BackgroundManagement` | Creation | Scene background management |
| `/workbench` | `StoryWorkbench` | Creation | Story workbench (core editing entry) |
| `/export` | `ExportCenter` | Creation | Export center |
| `/labs/image` | `ImageLab` | AI Labs | Image generation lab |
| `/labs/video` | `VideoLab` | AI Labs | Video generation lab |
| `/labs/voice` | `VoiceLab` | AI Labs | Voice & dubbing lab |
| `/labs/music` | `MusicLab` | AI Labs | Music generation lab |
| `/labs/text` | `TextLab` | AI Labs | Text enhancement lab |
| `/spaces` | `StorySpaceManagement` | Management | Space management |
| `/settings` | `Settings` | Management | Settings (API Key configuration, etc.) |

### Page Descriptions

| Page | File | Core Features |
|------|------|---------------|
| `Dashboard` | [Dashboard.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx) | Project overview, statistics, quick access |
| `CharacterManagement` | [CharacterManagement.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/CharacterManagement.tsx) | Character create/edit/delete, appearance/personality description, reference image, voice binding |
| `BackgroundManagement` | [BackgroundManagement.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/BackgroundManagement.tsx) | Scene create/edit/delete, environment description, reference image |
| `StoryWorkbench` | [StoryWorkbench.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/StoryWorkbench.tsx) | Story input, AI split/breakdown, segment editing, video generation, pipeline orchestration |
| `ExportCenter` | [ExportCenter.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/ExportCenter.tsx) | Final production list, download, preview |
| `ImageLab` | [ImageLab.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/ImageLab.tsx) | Standalone image generation, advanced parameter settings |
| `VideoLab` | [VideoLab.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx) | Standalone video generation, multi-mode selection |
| `VoiceLab` | [VoiceLab.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VoiceLab.tsx) | Voice cloning/design/synthesis, streaming playback |
| `MusicLab` | [MusicLab.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/MusicLab.tsx) | Music generation, lyrics creation, cover songs |
| `TextLab` | [TextLab.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/TextLab.tsx) | Text enhancement/polishing |
| `StorySpaceManagement` | [StorySpaceManagement.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/StorySpaceManagement.tsx) | Space create/switch/delete |
| `Settings` | [Settings.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Settings.tsx) | API Key / Group ID configuration |

---

## 12. Internationalization (i18n)

File: [i18n.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/i18n.ts)

### Supported Languages

| Code | Language | Native Name |
|------|----------|-------------|
| `en` | English | English |
| `zh` | Chinese (Simplified) | 简体中文 |
| `ja` | Japanese | 日本語 |
| `ko` | Korean | 한국어 |
| `es` | Spanish | Español |
| `fr` | French | Français |
| `de` | German | Deutsch |
| `ru` | Russian | Русский |
| `pt` | Portuguese | Português |
| `it` | Italian | Italiano |

### Configuration

- **Fallback Language**: `en`
- **Language Detection Order**: `localStorage` → `navigator` → `htmlTag`
- **Cache**: `localStorage` (key: `i18nextLng`)
- **Translation Files**: `src/locales/{lang}/translation.json`

---

## 13. Data Persistence (IndexedDB)

File: [DexieDatabase.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/adapters/outbound/repositories/DexieDatabase.ts)

### Database: `AiVideoDatabase`

[Dexie.js](https://dexie.org/)-based IndexedDB ORM, current version **v8**.

### Table Structure & Indexes

| Table Name | Indexed Fields | Version |
|------------|----------------|---------|
| `storySpaces` | `id`, `name`, `createdAt` | v3 |
| `characters` | `id`, `spaceId`, `name`, `createdAt` | v3 |
| `backgrounds` | `id`, `spaceId`, `name`, `createdAt` | v3 |
| `stories` | `id`, `spaceId`, `status`, `createdAt` | v3 |
| `segments` | `id`, `storyId`, `sequenceOrder` | v1 |
| `videoTasks` | `id`, `segmentId`, `status`, `createdAt` | v1 |
| `pipelineTasks` | `id`, `storyId`, `status`, `createdAt` | v7 |
| `finalCuts` | `id`, `storyId`, `pipelineTaskId`, `createdAt` | v7 |
| `savedImages` | `id`, `spaceId`, `name`, `sourceType`, `createdAt` | v8 |
| `savedVoices` | `id`, `spaceId`, `name`, `sourceType`, `createdAt` | v8 |
| `savedPrompts` | `id`, `spaceId`, `name`, `category`, `createdAt` | v8 |

### Version Migration History

| Version | Changes |
|---------|---------|
| v1 | Initial table structure |
| v2 | Added `characterBackground` field to Character |
| v3 | Added `storySpaces` table, added `spaceId` to all entities, created default space and migrated data |
| v4 | Added `voiceId` field to Character |
| v5 | Added BGM-related fields to Segment |
| v6 | Added mode/model/resolution/duration fields to VideoTask |
| v7 | Added `pipelineTasks` and `finalCuts` tables |
| v8 | Added `savedImages`, `savedVoices`, `savedPrompts` asset library tables |

---

## 14. Utilities & Infrastructure

### General Utilities (src/utils/)

| File | Description |
|------|-------------|
| [offlineCache.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/utils/offlineCache.ts) | Offline cache management, supports data caching and recovery during poor network conditions |
| [cacheMonitor.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/utils/cacheMonitor.ts) | Cache hit rate statistics and status monitoring |
| [retryUtils.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/utils/retryUtils.ts) | Configurable retry mechanism (count/delay strategy) |

### UI Utilities (src/ui/utils/)

| File | Description |
|------|-------------|
| [errorUtils.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/utils/errorUtils.ts) | Error message extraction and formatting |
| [imageUtils.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/utils/imageUtils.ts) | Image processing utilities (compression/cropping/format conversion) |

### Static Data

| File | Description |
|------|-------------|
| [systemVoices.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/domain/data/systemVoices.ts) | Built-in system voice list data |

---

## 15. Core Business Flows

### 15.1 One-Click Production Flow (Pipeline)

```
User inputs story text
       │
       ▼
  ┌─────────┐   AI Split   ┌──────────────┐
  │  Story   │ ──────────► │ StorySegments │
  │ (DRAFT)  │             │   (SPLIT)     │
  └─────────┘              └──────┬───────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │ Generate  │ │ Generate  │ │ Generate  │
             │  Images   │ │ Narration │ │   BGM     │
             │(Image API)│ │(Voice API)│ │(Music API)│
             └────┬─────┘ └────┬─────┘ └────┬─────┘
                  │            │             │
                  └─────────────┼─────────────┘
                                ▼
                        ┌──────────────┐
                        │   Generate   │
                        │    Video     │
                        │ (Video API)  │
                        │ T2V/I2V/S2V  │
                        └──────┬───────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
             ┌──────────┐ ┌────────┐ ┌──────────┐
             │  Post     │ │Subtitle│ │ Subtitle │
             │ Production│ │Generate│ │  Burn    │
             │ (FFmpeg)  │ │(Whisper)│ │ (FFmpeg) │
             └────┬─────┘ └───┬────┘ └────┬─────┘
                  │           │           │
                  └───────────┼───────────┘
                              ▼
                      ┌──────────────┐
                      │  FinalCut    │
                      │  (Export)    │
                      └──────────────┘
```

### 15.2 Video Generation Modes

| Mode | Description | Input |
|------|-------------|-------|
| `t2v` | Text-to-Video | Text Prompt |
| `i2v` | Image-to-Video | First frame image + Prompt |
| `fl2v` | First-Last frame to Video | First frame image + Last frame image + Prompt |
| `s2v` | Subject-reference to Video | Character reference image + Prompt |

### 15.3 Dependency Graph

```
PipelineService
├── StoryRepository ─────────► Load story
├── StorySegmentRepository ──► Load/save segments
├── CharacterRepository ─────► Find characters
├── BackgroundRepository ────► Find backgrounds
├── VideoTaskRepository ─────► Save video tasks
├── FinalCutRepository ──────► Save final production
├── ITextGenerationPort ─────► Text generation
├── IImageGeneratorPort ─────► Image generation
├── IVideoGeneratorPort ─────► Video generation
├── IVoicePort ──────────────► Voice synthesis
├── IMusicPort ──────────────► Music generation
├── PostProcessService ──────► FFmpeg post-processing
│   ├── IFFmpegPort
│   └── IWhisperPort
└── SubtitleService ─────────► Subtitle generation
    ├── IWhisperPort
    └── ITextGenerationPort
```

---

## 16. How to Run the Project

### Prerequisites

- Node.js >= 18
- npm >= 9

### Install & Start

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Code linting
npm run lint
```

### Development Environment Configuration

1. After starting the dev server, visit `http://localhost:5173`
2. Navigate to the **Settings page** (`/settings`) to configure:
   - MiniMax API Key
   - MiniMax Group ID
3. The Vite dev server automatically proxies the `/anthropic` path to `https://api.minimaxi.com/anthropic`, resolving CORS issues

### Vite Proxy Configuration

File: [vite.config.ts](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/vite.config.ts)

```typescript
server: {
  proxy: {
    '/anthropic': {
      target: 'https://api.minimaxi.com',
      changeOrigin: true,
      secure: true,
    },
  },
}
```

### Production Environment

In production, `minimaxAnthropicBaseUrl` points directly to `https://api.minimaxi.com/anthropic` without using a proxy.

---

> This document was auto-generated from code analysis. If you have questions, please refer to the source code or contact the project maintainers.
