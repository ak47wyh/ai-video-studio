import { useState, useEffect, useCallback, useRef } from 'react';
import { assetLibraryService } from '../../dependencies';
import type { SavedImage, SavedVoice, SavedPrompt, SavedVideo, SavedBgm } from '../../domain/entities/models';
import type { AssetQueryParams } from '../../domain/ports/AssetLibraryPorts';

/** 查询当前空间下保存的图片素材 */
export function useSavedImages(spaceId: string, params?: Omit<AssetQueryParams, 'spaceId'>) {
  const [images, setImages] = useState<SavedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsKey = JSON.stringify(params);

  // 用 ref 保存最新 params，使 refetch 引用稳定但始终读取最新值
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  const refetch = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const results = await assetLibraryService.queryImages({ spaceId, ...paramsRef.current });
      setImages(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load images');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch, paramsKey]);

  return { images, loading, error, refetch };
}

/** 查询当前空间下保存的音色素材 */
export function useSavedVoices(spaceId: string, params?: Omit<AssetQueryParams, 'spaceId'>) {
  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsKey = JSON.stringify(params);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  const refetch = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const results = await assetLibraryService.queryVoices({ spaceId, ...paramsRef.current });
      setVoices(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch, paramsKey]);

  return { voices, loading, error, refetch };
}

/** 查询当前空间下保存的提示词素材 */
export function useSavedPrompts(spaceId: string, params?: Omit<AssetQueryParams, 'spaceId'>) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsKey = JSON.stringify(params);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  const refetch = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const results = await assetLibraryService.queryPrompts({ spaceId, ...paramsRef.current });
      setPrompts(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prompts');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch, paramsKey]);

  return { prompts, loading, error, refetch };
}

/** 查询当前空间下保存的视频素材 */
export function useSavedVideos(spaceId: string, params?: Omit<AssetQueryParams, 'spaceId'>) {
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsKey = JSON.stringify(params);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  const refetch = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const results = await assetLibraryService.queryVideos({ spaceId, ...paramsRef.current });
      setVideos(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch, paramsKey]);

  return { videos, loading, error, refetch };
}

/** 查询当前空间下保存的 BGM 资产（P0-4） */
export function useSavedBgms(spaceId: string, params?: Omit<AssetQueryParams, 'spaceId'>) {
  const [bgms, setBgms] = useState<SavedBgm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsKey = JSON.stringify(params);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  const refetch = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const results = await assetLibraryService.queryBgms({ spaceId, ...paramsRef.current });
      setBgms(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bgms');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch, paramsKey]);

  return { bgms, loading, error, refetch };
}
