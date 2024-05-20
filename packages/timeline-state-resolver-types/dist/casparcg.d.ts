import { DeviceType } from '.';
export declare enum TimelineContentTypeCasparCg {
    MEDIA = "media",
    IP = "ip",
    INPUT = "input",
    TEMPLATE = "template",
    HTMLPAGE = "htmlpage",
    ROUTE = "route",
    RECORD = "record"
}
export type TimelineTransition = TimelineTransitionBase & (RegularTimelineTransition | TimelineStingTransition);
export interface TimelineTransitionBase {
    type: Transition;
}
export interface RegularTimelineTransition extends TimelineTransitionBase {
    type: Exclude<Transition, Transition.STING>;
    duration?: number;
    easing?: Ease;
    direction?: Direction;
}
export interface TimelineStingTransition extends TimelineTransitionBase {
    type: Transition.STING;
    maskFile: string;
    delay?: number;
    overlayFile?: string;
    audioFadeStart?: number;
    audioFadeDuration?: number;
}
export interface TimelineContentCCGProducerBase {
    /** The type of CasparCG content  */
    type: TimelineContentTypeCasparCg;
    transitions?: {
        inTransition?: TimelineTransition;
        outTransition?: TimelineTransition;
    };
    mixer?: Mixer;
}
export type TimelineContentCasparCGAny = TimelineContentCCGMedia | TimelineContentCCGIP | TimelineContentCCGInput | TimelineContentCCGHTMLPage | TimelineContentCCGRecord | TimelineContentCCGRoute | TimelineContentCCGTemplate;
export interface TimelineContentCasparCGBase {
    deviceType: DeviceType.CASPARCG;
    type: TimelineContentTypeCasparCg;
}
export interface TimelineContentCCGMedia extends TimelineContentCasparCGBase, TimelineContentCCGProducerBase {
    type: TimelineContentTypeCasparCg.MEDIA;
    /** Path to the file to be played (example: 'AMB') */
    file: string;
    /** Whether the media file should be looping or not */
    loop?: boolean;
    /** The point where the file starts playing [milliseconds from start of file] */
    seek?: number;
    /** The point where the file returns to, when looping [milliseconds from start of file] */
    inPoint?: number;
    /** The duration of the file. The playout will either freeze or loop after this time.
     * Note that for seeking to work when looping, .length has to be provided. [milliseconds]
     */
    length?: number;
    /** Audio channel layout (example 'stereo') */
    channelLayout?: string;
    /** When pausing, the unix-time the playout was paused. */
    pauseTime?: number;
    /** If the video is playing or is paused (defaults to true) */
    playing?: boolean;
    /** If true, the startTime won't be used to SEEK to the correct place in the media */
    noStarttime?: boolean;
    videoFilter?: string;
    audioFilter?: string;
}
export interface TimelineContentCCGIP extends TimelineContentCasparCGBase, TimelineContentCCGProducerBase {
    type: TimelineContentTypeCasparCg.IP;
    /** The URI to the input stream */
    uri: string;
    /** Audio channel layout (example 'stereo') */
    channelLayout?: string;
    videoFilter?: string;
    audioFilter?: string;
}
export interface TimelineContentCCGInput extends TimelineContentCasparCGBase, TimelineContentCCGProducerBase {
    type: TimelineContentTypeCasparCg.INPUT;
    /** The type of input (example: 'decklink') */
    inputType: string;
    /** The inoput device index (to check in CASPARCG, run INFO SYSTEM) */
    device: number;
    /** The input format (example: '1080i5000') */
    deviceFormat: ChannelFormat;
    /**
     * @deprecated use videoFilter instead
     */
    filter?: string;
    /** Audio channel layout (example 'stereo') */
    channelLayout?: string;
    videoFilter?: string;
    audioFilter?: string;
}
export interface TimelineContentCCGHTMLPage extends TimelineContentCasparCGBase, TimelineContentCCGProducerBase {
    type: TimelineContentTypeCasparCg.HTMLPAGE;
    /** The URL to load */
    url: string;
}
export interface TimelineContentCCGTemplate extends TimelineContentCasparCGBase, TimelineContentCCGProducerBase {
    type: TimelineContentTypeCasparCg.TEMPLATE;
    /** The type of template to load ('html' or 'flash') */
    templateType?: 'html' | 'flash';
    /** The name/path of the template */
    name: string;
    /** The data to send into the template. Fee to be whatever, as long as the template likes it */
    data?: any;
    /** Whether to use CG stop or CLEAR layer when stopping the template. Defaults to false = CLEAR  */
    useStopCommand: boolean;
}
export interface TimelineContentCCGRoute extends TimelineContentCasparCGBase, TimelineContentCCGProducerBase {
    type: TimelineContentTypeCasparCg.ROUTE;
    /** The CasparCG-channel to route from */
    channel?: number;
    /** The CasparCG-layer to route from */
    layer?: number;
    /** Uses the mappings to determine what layer to route (overrides channel/layer parameters) */
    mappedLayer?: string;
    /** Type of routing ('BACKGROUND' | 'NEXT') */
    mode?: 'BACKGROUND' | 'NEXT';
    /** Audio channel layout (example 'stereo') */
    channelLayout?: string;
    /** The amount of milliseconds to delay the signal on this route. This value is downsampled to channel frames upon execution. */
    delay?: number;
    videoFilter?: string;
    audioFilter?: string;
}
export interface TimelineContentCCGRecord extends TimelineContentCasparCGBase {
    type: TimelineContentTypeCasparCg.RECORD;
    /** The filename to output to (will be in the media folder) */
    file: string;
    /** ffmpeg encoder options (example '-vcodec libx264 -preset ultrafast') */
    encoderOptions: string;
}
export declare enum Transition {
    MIX = "MIX",
    CUT = "CUT",
    PUSH = "PUSH",
    WIPE = "WIPE",
    SLIDE = "SLIDE",
    STING = "STING",
    TSR_TRANSITION = "TSR_TRANSITION"
}
export declare enum Ease {
    LINEAR = "LINEAR",
    NONE = "NONE",
    EASEINBACK = "EASEINBACK",
    EASEINBOUNCE = "EASEINBOUNCE",
    EASEINCIRC = "EASEINCIRC",
    EASEINCUBIC = "EASEINCUBIC",
    EASEINELASTIC = "EASEINELASTIC",
    EASEINEXPO = "EASEINEXPO",
    EASEINOUTBACK = "EASEINOUTBACK",
    EASEINOUTBOUNCE = "EASEINOUTBOUNCE",
    EASEINOUTCIRC = "EASEINOUTCIRC",
    EASEINOUTCUBIC = "EASEINOUTCUBIC",
    EASEINOUTELASTIC = "EASEINOUTELASTIC",
    EASEINOUTEXPO = "EASEINOUTEXPO",
    EASEINOUTQUAD = "EASEINOUTQUAD",
    EASEINOUTQUART = "EASEINOUTQUART",
    EASEINOUTQUINT = "EASEINOUTQUINT",
    EASEINOUTSINE = "EASEINOUTSINE",
    EASEINQUAD = "EASEINQUAD",
    EASEINQUART = "EASEINQUART",
    EASEINQUINT = "EASEINQUINT",
    EASEINSINE = "EASEINSINE",
    EASELINEAR = "EASELINEAR",
    EASENONE = "EASENONE",
    EASEOUTBACK = "EASEOUTBACK",
    EASEOUTBOUNCE = "EASEOUTBOUNCE",
    EASEOUTCIRC = "EASEOUTCIRC",
    EASEOUTCUBIC = "EASEOUTCUBIC",
    EASEOUTELASTIC = "EASEOUTELASTIC",
    EASEOUTEXPO = "EASEOUTEXPO",
    EASEOUTINBACK = "EASEOUTINBACK",
    EASEOUTINBOUNCE = "EASEOUTINBOUNCE",
    EASEOUTINCIRC = "EASEOUTINCIRC",
    EASEOUTINCUBIC = "EASEOUTINCUBIC",
    EASEOUTINELASTIC = "EASEOUTINELASTIC",
    EASEOUTINEXPO = "EASEOUTINEXPO",
    EASEOUTINQUAD = "EASEOUTINQUAD",
    EASEOUTINQUART = "EASEOUTINQUART",
    EASEOUTINQUINT = "EASEOUTINQUINT",
    EASEOUTINSINE = "EASEOUTINSINE",
    EASEOUTQUAD = "EASEOUTQUAD",
    EASEOUTQUART = "EASEOUTQUART",
    EASEOUTQUINT = "EASEOUTQUINT",
    EASEOUTSINE = "EASEOUTSINE",
    IN_BACK = "IN_BACK",
    IN_BOUNCE = "IN_BOUNCE",
    IN_CIRC = "IN_CIRC",
    IN_CUBIC = "IN_CUBIC",
    IN_ELASTIC = "IN_ELASTIC",
    IN_EXPO = "IN_EXPO",
    IN_OUT_BACK = "IN_OUT_BACK",
    IN_OUT_BOUNCE = "IN_OUT_BOUNCE",
    IN_OUT_CIRC = "IN_OUT_CIRC",
    IN_OUT_CUBIC = "IN_OUT_CUBIC",
    IN_OUT_ELASTIC = "IN_OUT_ELASTIC",
    IN_OUT_EXPO = "IN_OUT_EXPO",
    IN_OUT_QUAD = "IN_OUT_QUAD",
    IN_OUT_QUART = "IN_OUT_QUART",
    IN_OUT_QUINT = "IN_OUT_QUINT",
    IN_OUT_SINE = "IN_OUT_SINE",
    IN_QUAD = "IN_QUAD",
    IN_QUART = "IN_QUART",
    IN_QUINT = "IN_QUINT",
    IN_SINE = "IN_SINE",
    OUT_BACK = "OUT_BACK",
    OUT_BOUNCE = "OUT_BOUNCE",
    OUT_CIRC = "OUT_CIRC",
    OUT_CUBIC = "OUT_CUBIC",
    OUT_ELASTIC = "OUT_ELASTIC",
    OUT_EXPO = "OUT_EXPO",
    OUT_IN_BACK = "OUT_IN_BACK",
    OUT_IN_BOUNCE = "OUT_IN_BOUNCE",
    OUT_IN_CIRC = "OUT_IN_CIRC",
    OUT_IN_CUBIC = "OUT_IN_CUBIC",
    OUT_IN_ELASTIC = "OUT_IN_ELASTIC",
    OUT_IN_EXPO = "OUT_IN_EXPO",
    OUT_IN_QUAD = "OUT_IN_QUAD",
    OUT_IN_QUART = "OUT_IN_QUART",
    OUT_IN_QUINT = "OUT_IN_QUINT",
    OUT_IN_SINE = "OUT_IN_SINE",
    OUT_QUAD = "OUT_QUAD",
    OUT_QUART = "OUT_QUART",
    OUT_QUINT = "OUT_QUINT",
    INTERNAL_PHYSICAL = "INTERNAL_PHYSICAL"
}
export declare enum Direction {
    LEFT = "LEFT",
    RIGHT = "RIGHT"
}
export declare enum BlendMode {
    ADD = "ADD",
    AVERAGE = "AVERAGE",
    COLOR = "COLOR",
    COLOR_BURN = "COLOR_BURN",
    COLOR_DODGE = "COLOR_DODGE",
    CONTRAST = "CONTRAST",
    DARKEN = "DARKEN",
    DIFFERENCE = "DIFFERENCE",
    EXCLUSION = "EXCLUSION",
    GLOW = "GLOW",
    HARD_LIGHT = "HARD_LIGHT",
    HARD_MIX = "HARD_MIX",
    LIGHTEN = "LIGHTEN",
    LINEAR_BURN = "LINEAR_BURN",
    LINEAR_DODGE = "LINEAR_DODGE",
    LINEAR_LIGHT = "LINEAR_LIGHT",
    LUMINOSITY = "LUMINOSITY",
    MULTIPLY = "MULTIPLY",
    NEGATION = "NEGATION",
    NORMAL = "NORMAL",
    OVERLAY = "OVERLAY",
    PHOENIX = "PHOENIX",
    PIN_LIGHT = "PIN_LIGHT",
    REFLECT = "REFLECT",
    SATURATION = "SATURATION",
    SCREEN = "SCREEN",
    SOFT_LIGHT = "SOFT_LIGHT",
    SUBTRACT = "SUBTRACT",
    VIVID_LIGHT = "VIVID_LIGHT"
}
export declare enum ChannelFormat {
    PAL = "PAL",
    NTSC = "NTSC",
    SD_576P2500 = "576P2500",
    HD_720P2398 = "720P2398",
    HD_720P2400 = "720P2400",
    HD_720P2500 = "720P2500",
    HD_720P2997 = "720P2997",
    HD_720P3000 = "720P3000",
    HD_720P5000 = "720P5000",
    HD_720P5994 = "720P5994",
    HD_720P6000 = "720P6000",
    HD_1080I5000 = "1080I5000",
    HD_1080I5994 = "1080I5994",
    HD_1080I6000 = "1080I6000",
    HD_1080P2398 = "1080P2398",
    HD_1080P2400 = "1080P2400",
    HD_1080P2500 = "1080P2500",
    HD_1080P2997 = "1080P2997",
    HD_1080P3000 = "1080P3000",
    HD_1080P5000 = "1080P5000",
    HD_1080P5994 = "1080P5994",
    HD_1080P6000 = "1080P6000",
    DCI_1080P2398 = "dci1080P2398",
    DCI_1080P2400 = "dci1080P2400",
    DCI_1080P2500 = "dci1080P2500",
    DCI_2160P2398 = "dci2160P2398",
    DCI_2160P2400 = "dci2160P2400",
    DCI_2160P2500 = "dci2160P2500",
    UCH_2160P2400 = "2160P2400",
    UHD_1556P2398 = "1556P2398",
    UHD_1556P2400 = "1556P2400",
    UHD_1556P2500 = "1556P2500",
    UHD_2160P2398 = "2160P2398",
    UHD_2160P2500 = "2160P2500",
    UHD_2160P2997 = "2160P2997",
    UHD_2160P3000 = "2160P3000",
    UHD_2160P5000 = "2160P5000",
    UHD_2160P5994 = "2160P5994",
    UHD_2160P6000 = "2160P6000",
    INVALID = "INVALID"
}
export declare enum Chroma {
    BLUE = "BLUE",
    GREEN = "GREEN",
    NONE = "NONE"
}
export interface Mixer {
    inTransition?: CasparCGTransition;
    changeTransition?: CasparCGTransition;
    outTransition?: CasparCGTransition;
    anchor?: {
        x: number;
        y: number;
    } | TransitionObject;
    blend?: BlendMode | TransitionObject;
    brightness?: number | TransitionObject;
    chroma?: {
        keyer: Chroma;
        threshold: number;
        softness: number;
        spill: number;
    } | TransitionObject;
    clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | TransitionObject;
    contrast?: number | TransitionObject;
    crop?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    } | TransitionObject;
    fill?: {
        x: number;
        y: number;
        xScale: number;
        yScale: number;
    } | TransitionObject;
    keyer?: boolean | TransitionObject;
    levels?: {
        minInput: number;
        maxInput: number;
        gamma: number;
        minOutput: number;
        maxOutput: number;
    } | TransitionObject;
    mastervolume?: number | TransitionObject;
    opacity?: number | TransitionObject;
    perspective?: {
        topLeftX: number;
        topLeftY: number;
        topRightX: number;
        topRightY: number;
        bottomRightX: number;
        bottomRightY: number;
        bottomLeftX: number;
        bottomLeftY: number;
    } | TransitionObject;
    rotation?: number | TransitionObject;
    saturation?: number | TransitionObject;
    straightAlpha?: boolean | TransitionObject;
    volume?: number | TransitionObject;
    bundleWithCommands?: number;
}
/** Options for internal TSR Transitions */
export interface TSRTransitionOptions {
    /** How often to send updates for the transition. [ms] */
    updateInterval?: number;
    linearSpeed?: number;
    acceleration?: number;
    maxSpeed?: number;
    snapDistance?: number;
}
export interface TransitionObject {
    _value: string | number | boolean;
    inTransition: CasparCGTransition;
    changeTransition: CasparCGTransition;
    outTransition: CasparCGTransition;
}
/** Transition of mixer properties */
export interface CasparCGTransitionInner {
    duration?: number;
    easing?: Ease;
    direction?: Direction;
}
export interface TSRTansition {
    type: Transition.TSR_TRANSITION;
    customOptions: TSRTransitionOptions;
}
export type CasparCGTransition = CasparCGTransitionInner | TSRTansition;
//# sourceMappingURL=casparcg.d.ts.map