import { DeviceType } from '.';
export declare enum TimelineContentTypePharos {
    SCENE = "scene",
    TIMELINE = "timeline"
}
export type TimelineContentPharosAny = TimelineContentPharosScene | TimelineContentPharosTimeline;
export interface TimelineContentPharos {
    deviceType: DeviceType.PHAROS;
    type: TimelineContentTypePharos;
    /** override: don't stop / release */
    noRelease?: true;
    stopped?: boolean;
}
export interface TimelineContentPharosScene extends TimelineContentPharos {
    type: TimelineContentTypePharos.SCENE;
    stopped?: boolean;
    noRelease?: true;
    scene: number;
    fade?: number;
}
export interface TimelineContentPharosTimeline extends TimelineContentPharos {
    type: TimelineContentTypePharos.TIMELINE;
    stopped?: boolean;
    noRelease?: true;
    timeline: number;
    pause?: boolean;
    rate?: boolean;
    fade?: number;
}
//# sourceMappingURL=pharos.d.ts.map