/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-duplicate-type-constituents */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/only-throw-error */

/*
  From https://github.com/microsoft/vscode/blob/main/src/vs/base/common/async.ts circa https://github.com/microsoft/vscode/blob/c635a395496a0699e6c6748d37b974fb4fba18cc/src/vs/base/common/async.ts
*/

import { CancellationToken, EventEmitter, Uri, CancellationTokenSource } from "vscode";

// #region -- Copied from vs/base/common/errors as workaround for importing

const canceledName = "Canceled";
/**
 * Returns an error that signals cancellation.
 * @returns
 */
function canceled(): Error {
	const error = new Error(canceledName);
	error.name = error.message;
	return error;
}

/**
 * Checks if the given error is a promise in canceled state
 * @param error
 * @returns
 */
export function isPromiseCanceledError(error: any): boolean {
	return error instanceof Error && error.name === canceledName && error.message === canceledName;
}

// #endregion

// #region -- Copied from vs/base/common/events as workaround for importing

/**
 * To an event a function with one or zero parameters
 * can be subscribed. The event is the subscriber function itself.
 */
export interface Event<T> {
	(listener: (e: T) => any, thisArgs?: any, disposables?: IDisposable[]): IDisposable;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Event {
	/**
	 * Given an event, returns another event which only fires once.
	 * @param event
	 * @returns
	 */
	export function once<T>(event: Event<T>): Event<T> {
		return (listener, thisArgs = null, disposables?) => {
			// we need this, in case the event fires during the listener call
			let didFire = false;
			const result: IDisposable = event((e) => {
				if (didFire) {
					return;
				}
				else if (result) {
					result.dispose();
				}
				else {
					didFire = true;
				}

				return listener.call(thisArgs, e);
			}, null, disposables);

			if (didFire) {
				result.dispose();
			}

			return result;
		};
	}

	/**
	 *
	 * @param event
	 * @returns
	 */
	export function toPromise<T>(event: Event<T>): Promise<T> {
		return new Promise(resolve => once(event)(resolve));
	}
}

// #endregion

/**
 *
 * @param obj
 * @returns
 */
export function isThenable<T>(obj: unknown): obj is Promise<T> {
	return !!obj && typeof (obj as unknown as Promise<T>).then === "function";
}

export interface CancelablePromise<T> extends Promise<T> {
	cancel(): void;
}

/**
 *
 * @param callback
 * @returns
 */
export function createCancelablePromise<T>(callback: (token: CancellationToken) => Promise<T>): CancelablePromise<T> {
	const source = new CancellationTokenSource();

	const thenable = callback(source.token);
	const promise = new Promise<T>((resolve, reject) => {
		const subscription = source.token.onCancellationRequested(() => {
			subscription.dispose();
			source.dispose();
			reject(canceled());
		});
		Promise.resolve(thenable).then((value) => {
			subscription.dispose();
			source.dispose();
			resolve(value);
		}, (err) => {
			subscription.dispose();
			source.dispose();
			reject(err);
		});
	});

	return new class implements CancelablePromise<T> {
		readonly [Symbol.toStringTag] = "promise";
		cancel(): void {
			source.cancel();
		}

		then<TResult1 = T, TResult2 = never>(resolve?: ((value: T) => TResult1 | Promise<TResult1>) | undefined | null, reject?: ((reason: any) => TResult2 | Promise<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
			return promise.then(resolve, reject);
		}

		catch<TResult = never>(reject?: ((reason: any) => TResult | Promise<TResult>) | undefined | null): Promise<T | TResult> {
			return this.then(undefined, reject);
		}

		finally(onfinally?: (() => void) | undefined | null): Promise<T> {
			return promise.finally(onfinally);
		}
	}();
}

export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken): Promise<T | undefined>;
export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken, defaultValue: T): Promise<T>;
/**
 *
 * @param promise
 * @param token
 * @param defaultValue
 * @returns
 */
export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken, defaultValue?: T): Promise<T | undefined> {
	return Promise.race([promise, new Promise<T | undefined>(resolve => token.onCancellationRequested(() => resolve(defaultValue)))]);
}

/**
 * Returns as soon as one of the promises is resolved and cancels remaining promises
 * @param cancellablePromises
 * @returns
 */
export async function raceCancellablePromises<T>(cancellablePromises: CancelablePromise<T>[]): Promise<T> {
	let resolvedPromiseIndex = -1;
	const promises = cancellablePromises.map((promise, index) => promise.then((result) => {
		resolvedPromiseIndex = index;
		return result;
	}));
	const result = await Promise.race(promises);
	cancellablePromises.forEach((cancellablePromise, index) => {
		if (index !== resolvedPromiseIndex) {
			cancellablePromise.cancel();
		}
	});
	return result;
}

/**
 *
 * @param promise
 * @param timeout
 * @param onTimeout
 * @returns
 */
export function raceTimeout<T>(promise: Promise<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		promiseResolve?.(undefined);
		onTimeout?.();
	}, timeout);

	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T | undefined>(resolve => promiseResolve = resolve),
	]);
}

/**
 *
 * @param callback
 * @returns
 */
export function asPromise<T>(callback: () => T | Thenable<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const item = callback();
		if (isThenable<T>(item)) {
			item.then(resolve, reject);
		}
		else {
			resolve(item);
		}
	});
}

export interface ITask<T> {
	(): T;
}

interface IDisposable {
	/**
	 * Dispose and free associated resources.
	 */
	dispose(): void;
}

function toDisposable(fn: () => void): IDisposable {
	return {
		dispose(): void {
			fn();
		},
	};
}

/**
 * A helper to prevent accumulation of sequential async tasks.
 *
 * Imagine a mail man with the sole task of delivering letters. As soon as
 * a letter submitted for delivery, he drives to the destination, delivers it
 * and returns to his base. Imagine that during the trip, N more letters were submitted.
 * When the mail man returns, he picks those N letters and delivers them all in a
 * single trip. Even though N+1 submissions occurred, only 2 deliveries were made.
 *
 * The throttler implements this via the queue() method, by providing it a task
 * factory. Following the example:
 *
 * ```typescript
 * const throttler = new Throttler();
 * const letters = [];
 *
 * function deliver() {
 *     const lettersToDeliver = letters;
 *     letters = [];
 *     return makeTheTrip(lettersToDeliver);
 * }
 *
 * function onLetterReceived(l) {
 *     letters.push(l);
 *     throttler.queue(deliver);
 * }
 * ```
 */
export class Throttler<T> {
	private activePromise: Promise<T> | null;
	private queuedPromise: Promise<T> | null;
	private queuedPromiseFactory: ITask<Promise<T>> | null;

	constructor() {
		this.activePromise = null;
		this.queuedPromise = null;
		this.queuedPromiseFactory = null;
	}

	public queue(promiseFactory: ITask<Promise<T>>): Promise<T> {
		if (this.activePromise) {
			this.queuedPromiseFactory = promiseFactory;

			if (!this.queuedPromise) {
				const onComplete = (): Promise<T> => {
					this.queuedPromise = null;

					const result = this.queue(this.queuedPromiseFactory!);
					this.queuedPromiseFactory = null;

					return result;
				};

				this.queuedPromise = new Promise<T>((resolve) => {
					this.activePromise!.then(onComplete, onComplete).then(resolve);
				});
			}

			return new Promise<T>((resolve, reject) => {
				this.queuedPromise!.then(resolve, reject);
			});
		}

		this.activePromise = promiseFactory();

		return new Promise<T>((resolve, reject) => {
			this.activePromise!.then((result: T) => {
				this.activePromise = null;
				resolve(result);
			}, (err: unknown) => {
				this.activePromise = null;
				reject(err);
			});
		});
	}
}

export class Sequencer {
	private current: Promise<unknown> = Promise.resolve(null);

	queue<T>(promiseTask: ITask<Promise<T>>): Promise<T> {
		return this.current = this.current.then(() => promiseTask(), () => promiseTask());
	}
}

export class SequencerByKey<TKey> {
	private promiseMap = new Map<TKey, Promise<unknown>>();

	queue<T>(key: TKey, promiseTask: ITask<Promise<T>>): Promise<T> {
		const runningPromise = this.promiseMap.get(key) ?? Promise.resolve();
		const newPromise = runningPromise
			.catch(() => { })
			.then(promiseTask)
			.finally(() => {
				if (this.promiseMap.get(key) === newPromise) {
					this.promiseMap.delete(key);
				}
			});
		this.promiseMap.set(key, newPromise);
		return newPromise;
	}
}

interface IScheduledLater extends IDisposable {
	isTriggered(): boolean;
}

const timeoutDeferred = (timeout: number, fn: () => void): IScheduledLater => {
	let scheduled = true;
	const handle = setTimeout(() => {
		scheduled = false;
		fn();
	}, timeout);
	return {
		isTriggered: () => scheduled,
		dispose: () => {
			clearTimeout(handle);
			scheduled = false;
		},
	};
};

const microtaskDeferred = (fn: () => void): IScheduledLater => {
	let scheduled = true;
	queueMicrotask(() => {
		if (scheduled) {
			scheduled = false;
			fn();
		}
	});

	return {
		isTriggered: () => scheduled,
		dispose: () => { scheduled = false; },
	};
};

/** Can be passed into the Delayed to defer using a microtask */
export const MicrotaskDelay = Symbol("MicrotaskDelay");

/**
 * A helper to delay (debounce) execution of a task that is being requested often.
 *
 * Following the throttler, now imagine the mail man wants to optimize the number of
 * trips proactively. The trip itself can be long, so he decides not to make the trip
 * as soon as a letter is submitted. Instead he waits a while, in case more
 * letters are submitted. After said waiting period, if no letters were submitted, he
 * decides to make the trip. Imagine that N more letters were submitted after the first
 * one, all within a short period of time between each other. Even though N+1
 * submissions occurred, only 1 delivery was made.
 *
 * The delayer offers this behavior via the trigger() method, into which both the task
 * to be executed and the waiting period (delay) must be passed in as arguments. Following
 * the example:
 *
 * ```typescript
 * const delayer = new Delayer(WAITING_PERIOD);
 * const letters = [];
 *
 * function letterReceived(l) {
 *     letters.push(l);
 *     delayer.trigger(() => { return makeTheTrip(); });
 * }
 * ```
 */
export class Delayer<T> implements IDisposable {
	private deferred: IScheduledLater | null | undefined;
	private completionPromise: Promise<T | null | undefined> | null | undefined;
	// also referred to as onResolve or onSuccess
	private doResolve: ((value: T | Promise<T | null | undefined> | null | undefined) => void) | null | undefined;
	private doReject: ((err: any) => void) | null | undefined;
	private task: ITask<T | Promise<T | null | undefined>> | null | undefined;

	constructor(public defaultDelay: number | typeof MicrotaskDelay) {
		this.deferred = null;
		this.completionPromise = null;
		this.doResolve = null;
		this.doReject = null;
		this.task = null;
	}

	public trigger(task: ITask<T | Promise<T | null | undefined>>, delay = this.defaultDelay): Promise<T | null | undefined> {
		this.task = task;
		this.cancelTimeout();

		if (!this.completionPromise) {
			this.completionPromise = new Promise<T | null | undefined>((resolve, reject) => {
				this.doResolve = resolve;
				this.doReject = reject;
			}).then(() => {
				this.completionPromise = null;
				this.doResolve = null;
				if (this.task) {
					const task = this.task;
					this.task = null;
					return task();
				}
				return undefined;
			});
		}

		const fn = () => {
			this.deferred = null;
			this.doResolve?.(null);
		};

		this.deferred = delay === MicrotaskDelay ? microtaskDeferred(fn) : timeoutDeferred(delay, fn);

		return this.completionPromise;
	}

	public forceDelivery(): Promise<T | null | undefined> | null | undefined {
		if (!this.completionPromise) {
			return null;
		}
		this.cancelTimeout();
		const result = this.completionPromise;
		this.doResolve!(undefined);
		return result;
	}

	public isTriggered(): boolean {
		return !!this.deferred?.isTriggered();
	}

	public cancel(): void {
		this.cancelTimeout();

		if (this.completionPromise) {
			if (this.doReject) {
				this.doReject(canceled());
			}
			this.completionPromise = null;
		}
	}

	private cancelTimeout(): void {
		this.deferred?.dispose();
		this.deferred = null;
	}

	dispose(): void {
		this.cancel();
	}
}

/**
 * A helper to delay execution of a task that is being requested often, while
 * preventing accumulation of consecutive executions, while the task runs.
 *
 * The mail man is clever and waits for a certain amount of time, before going
 * out to deliver letters. While the mail man is going out, more letters arrive
 * and can only be delivered once he is back. Once he is back the mail man will
 * do one more trip to deliver the letters that have accumulated while he was out.
 */
export class ThrottledDelayer<T> {
	private delayer: Delayer<Promise<T>>;
	private throttler: Throttler<T>;

	constructor(defaultDelay: number) {
		this.delayer = new Delayer(defaultDelay);
		this.throttler = new Throttler<T>();
	}

	trigger(promiseFactory: ITask<Promise<T>>, delay?: number): Promise<T> {
		return this.delayer.trigger(() => this.throttler.queue(promiseFactory), delay) as unknown as Promise<T>;
	}

	isTriggered(): boolean {
		return this.delayer.isTriggered();
	}

	cancel(): void {
		this.delayer.cancel();
	}

	dispose(): void {
		this.delayer.dispose();
	}
}

/**
 * A barrier that is initially closed and then becomes opened permanently.
 */
export class Barrier {
	private _isOpen: boolean;
	private _promise: Promise<boolean>;
	private _completePromise!: (v: boolean) => void;

	constructor() {
		this._isOpen = false;
		this._promise = new Promise<boolean>((resolve) => {
			this._completePromise = resolve;
		});
	}

	isOpen(): boolean {
		return this._isOpen;
	}

	open(): void {
		this._isOpen = true;
		this._completePromise(true);
	}

	wait(): Promise<boolean> {
		return this._promise;
	}
}

/**
 * A barrier that is initially closed and then becomes opened permanently after a certain period of
 * time or when open is called explicitly
 */
export class AutoOpenBarrier extends Barrier {
	private readonly _timeout: any;

	constructor(autoOpenTimeMs: number) {
		super();
		this._timeout = setTimeout(() => this.open(), autoOpenTimeMs);
	}

	override open(): void {
		clearTimeout(this._timeout);
		super.open();
	}
}

export function timeout(millis: number): CancelablePromise<void>;
export function timeout(millis: number, token: CancellationToken): Promise<void>;
/**
 *
 * @param millis
 * @param token
 * @returns
 */
export function timeout(millis: number, token?: CancellationToken): CancelablePromise<void> | Promise<void> {
	if (!token) {
		return createCancelablePromise(token => timeout(millis, token));
	}

	return new Promise((resolve, reject) => {
		const handle = setTimeout(resolve, millis);
		token.onCancellationRequested(() => {
			clearTimeout(handle);
			reject(canceled());
		});
	});
}

/**
 *
 * @param handler
 * @param timeout
 * @returns
 */
export function disposableTimeout(handler: () => void, timeout = 0): IDisposable {
	const timer = setTimeout(handler, timeout);
	return toDisposable(() => clearTimeout(timer));
}

/**
 * Runs the provided list of promise factories in sequential order. The returned
 * promise will complete to an array of results from each promise.
 */

/**
 *
 * @param promiseFactories
 * @returns
 */
export async function sequence<T>(promiseFactories: ITask<Promise<T>>[]): Promise<T[]> {
	const results: T[] = [];
	let index = 0;
	const len = promiseFactories.length;

	function next(): Promise<T> | null {
		return index < len ? promiseFactories[index++]() : null;
	}

	function thenHandler(result: any): Promise<any> {
		if (result !== undefined && result !== null) {
			results.push(result);
		}

		const n = next();
		if (n) {
			return n.then(thenHandler);
		}

		return Promise.resolve(results);
	}

	return thenHandler(await Promise.resolve(null));
}

/**
 *
 * @param promiseFactories
 * @param shouldStop
 * @param defaultValue
 * @returns
 */
export function first<T>(promiseFactories: ITask<Promise<T>>[], shouldStop: (t: T) => boolean = t => !!t, defaultValue: T | null = null): Promise<T | null> {
	let index = 0;
	const len = promiseFactories.length;

	const loop: () => Promise<T | null> = async () => {
		if (index >= len) {
			return Promise.resolve(defaultValue);
		}

		const factory = promiseFactories[index++];
		const promise = Promise.resolve(factory());

		const result = await promise;
		if (shouldStop(result)) {
			return Promise.resolve(result);
		}
		return loop();
	};

	return loop();
}

/**
 * Returns the result of the first promise that matches the "shouldStop",
 * running all promises in parallel. Supports cancelable promises.
 * @param promiseList
 * @param shouldStop
 * @param defaultValue
 * @returns
 */
export function firstParallel<T>(promiseList: Promise<T>[], shouldStop?: (t: T) => boolean, defaultValue?: T | null): Promise<T | null>;
export function firstParallel<T, R extends T>(promiseList: Promise<T>[], shouldStop: (t: T) => t is R, defaultValue?: R | null): Promise<R | null>;
/**
 *
 * @param promiseList
 * @param shouldStop
 * @param defaultValue
 * @returns
 */
export function firstParallel<T>(promiseList: Promise<T>[], shouldStop: (t: T) => boolean = t => !!t, defaultValue: T | null = null) {
	if (promiseList.length === 0) {
		return Promise.resolve(defaultValue);
	}

	let todo = promiseList.length;
	const finish = () => {
		todo = -1;
		for (const promise of promiseList) {
			(promise as Partial<CancelablePromise<T>>).cancel?.();
		}
	};

	return new Promise<T | null>((resolve, reject) => {
		for (const promise of promiseList) {
			promise
				.then((result) => {
					if (--todo >= 0 && shouldStop(result)) {
						finish();
						resolve(result);
					}
					else if (todo === 0) {
						resolve(defaultValue);
					}
				})
				.catch((err) => {
					if (--todo >= 0) {
						finish();
						reject(err);
					}
				});
		}
	});
}

interface ILimitedTaskFactory<T> {
	factory: ITask<Promise<T>>;
	c: (value: T | Promise<T>) => void;
	e: (error?: unknown) => void;
}

export interface ILimiter<T> {

	readonly size: number;

	queue(factory: ITask<Promise<T>>): Promise<T>;
}

/**
 * A helper to queue N promises and run them all with a max degree of parallelism. The helper
 * ensures that at any time no more than M promises are running at the same time.
 */
export class Limiter<T> implements ILimiter<T> {
	private _size = 0;
	private runningPromises: number;
	private maxDegreeOfParalellism: number;
	private outstandingPromises: ILimitedTaskFactory<T>[];
	private readonly _onFinished: EventEmitter<void>;

	constructor(maxDegreeOfParalellism: number) {
		this.maxDegreeOfParalellism = maxDegreeOfParalellism;
		this.outstandingPromises = [];
		this.runningPromises = 0;
		this._onFinished = new EventEmitter<void>();
	}

	get onFinished(): Event<void> {
		return this._onFinished.event;
	}

	get size(): number {
		return this._size;
	}

	queue(factory: ITask<Promise<T>>): Promise<T> {
		this._size++;

		return new Promise<T>((c, e) => {
			this.outstandingPromises.push({ factory, c, e });
			this.consume();
		});
	}

	private consume(): void {
		while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParalellism) {
			const iLimitedTask = this.outstandingPromises.shift()!;
			this.runningPromises++;

			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c, iLimitedTask.e);
			promise.then(() => this.consumed(), () => this.consumed());
		}
	}

	private consumed(): void {
		this._size--;
		this.runningPromises--;

		if (this.outstandingPromises.length > 0) {
			this.consume();
		}
		else {
			this._onFinished.fire();
		}
	}

	dispose(): void {
		this._onFinished.dispose();
	}
}

/**
 * A queue handles one promise at a time and guarantees that at any time only one promise is executing.
 */
export class Queue<T> extends Limiter<T> {
	constructor() {
		super(1);
	}
}

/**
 * A helper to organize queues per resource. The ResourceQueue makes sure to manage queues per resource
 * by disposing them once the queue is empty.
 */
export class ResourceQueue implements IDisposable {
	private readonly queues = new Map<string, Queue<void>>();

	private readonly drainers = new Set<DeferredPromise<void>>();

	async whenDrained(): Promise<void> {
		if (this.isDrained()) {
			return;
		}

		const promise = new DeferredPromise<void>();
		this.drainers.add(promise);

		return promise.p;
	}

	private isDrained(): boolean {
		for (const [, queue] of this.queues) {
			if (queue.size > 0) {
				return false;
			}
		}

		return true;
	}

	queueFor(resource: Uri): ILimiter<void> {
		const key = resource.toString();

		let queue = this.queues.get(key);
		if (!queue) {
			queue = new Queue<void>();
			Event.once(queue.onFinished)(() => {
				queue?.dispose();
				this.queues.delete(key);
				this.onDidQueueFinish();
			});

			this.queues.set(key, queue);
		}

		return queue;
	}

	private onDidQueueFinish(): void {
		if (!this.isDrained()) {
			return; // not done yet
		}

		this.releaseDrainers();
	}

	private releaseDrainers(): void {
		for (const drainer of this.drainers) {
			drainer.complete();
		}

		this.drainers.clear();
	}

	dispose(): void {
		for (const [, queue] of this.queues) {
			queue.dispose();
		}

		this.queues.clear();

		// Even though we might still have pending
		// tasks queued, after the queues have been
		// disposed, we can no longer track them, so
		// we release drainers to prevent hanging
		// promises when the resource queue is being
		// disposed.
		this.releaseDrainers();
	}
}

export class TimeoutTimer implements IDisposable {
	private _token: any;

	constructor();
	constructor(runner: () => void, timeout: number);
	constructor(runner?: () => void, timeout?: number) {
		this._token = -1;

		if (typeof runner === "function" && typeof timeout === "number") {
			this.setIfNotSet(runner, timeout);
		}
	}

	dispose(): void {
		this.cancel();
	}

	cancel(): void {
		if (this._token !== -1) {
			clearTimeout(this._token);
			this._token = -1;
		}
	}

	cancelAndSet(runner: () => void, timeout: number): void {
		this.cancel();
		this._token = setTimeout(() => {
			this._token = -1;
			runner();
		}, timeout);
	}

	setIfNotSet(runner: () => void, timeout: number): void {
		if (this._token !== -1) {
			// timer is already set
			return;
		}
		this._token = setTimeout(() => {
			this._token = -1;
			runner();
		}, timeout);
	}
}

export class IntervalTimer implements IDisposable {
	private _token: any;

	constructor() {
		this._token = -1;
	}

	dispose(): void {
		this.cancel();
	}

	cancel(): void {
		if (this._token !== -1) {
			clearInterval(this._token);
			this._token = -1;
		}
	}

	cancelAndSet(runner: () => void, interval: number): void {
		this.cancel();
		this._token = setInterval(() => {
			runner();
		}, interval);
	}
}

export class RunOnceScheduler {
	protected runner: ((...args: unknown[]) => void) | null;

	private timeoutToken: any;
	private timeout: number;
	private timeoutHandler: () => void;

	constructor(runner: (...args: any[]) => void, delay: number) {
		this.timeoutToken = -1;
		this.runner = runner;
		this.timeout = delay;
		this.timeoutHandler = this.onTimeout.bind(this);
	}

	/**
	 * Dispose RunOnceScheduler
	 */
	dispose(): void {
		this.cancel();
		this.runner = null;
	}

	/**
	 * Cancel current scheduled runner (if any).
	 */
	cancel(): void {
		if (this.isScheduled()) {
			clearTimeout(this.timeoutToken);
			this.timeoutToken = -1;
		}
	}

	/**
	 * Cancel previous runner (if any) & schedule a new runner.
	 * @param delay
	 */
	schedule(delay = this.timeout): void {
		this.cancel();
		this.timeoutToken = setTimeout(this.timeoutHandler, delay);
	}

	get delay(): number {
		return this.timeout;
	}

	set delay(value: number) {
		this.timeout = value;
	}

	/**
	 * Returns true if scheduled.
	 * @returns
	 */
	isScheduled(): boolean {
		return this.timeoutToken !== -1;
	}

	private onTimeout(): void {
		this.timeoutToken = -1;
		if (this.runner) {
			this.doRun();
		}
	}

	protected doRun(): void {
		if (this.runner) {
			this.runner();
		}
	}
}

/**
 * Same as `RunOnceScheduler`, but doesn't count the time spent in sleep mode.
 * > **NOTE**: Only offers 1s resolution.
 *
 * When calling `setTimeout` with 3hrs, and putting the computer immediately to sleep
 * for 8hrs, `setTimeout` will fire **as soon as the computer wakes from sleep**. But
 * this scheduler will execute 3hrs **after waking the computer from sleep**.
 */
export class ProcessTimeRunOnceScheduler {
	private runner: (() => void) | null;
	private timeout: number;

	private counter: number;
	private intervalToken: any;
	private intervalHandler: () => void;

	constructor(runner: () => void, delay: number) {
		if (delay % 1000 !== 0) {
			console.warn(`ProcessTimeRunOnceScheduler resolution is 1s, ${delay}ms is not a multiple of 1000ms.`);
		}
		this.runner = runner;
		this.timeout = delay;
		this.counter = 0;
		this.intervalToken = -1;
		this.intervalHandler = this.onInterval.bind(this);
	}

	dispose(): void {
		this.cancel();
		this.runner = null;
	}

	cancel(): void {
		if (this.isScheduled()) {
			clearInterval(this.intervalToken);
			this.intervalToken = -1;
		}
	}

	/**
	 * Cancel previous runner (if any) & schedule a new runner.
	 * @param delay
	 */
	schedule(delay = this.timeout): void {
		if (delay % 1000 !== 0) {
			console.warn(`ProcessTimeRunOnceScheduler resolution is 1s, ${delay}ms is not a multiple of 1000ms.`);
		}
		this.cancel();
		this.counter = Math.ceil(delay / 1000);
		this.intervalToken = setInterval(this.intervalHandler, 1000);
	}

	/**
	 * Returns true if scheduled.
	 * @returns
	 */
	isScheduled(): boolean {
		return this.intervalToken !== -1;
	}

	private onInterval() {
		this.counter--;
		if (this.counter > 0) {
			// still need to wait
			return;
		}

		// time elapsed
		clearInterval(this.intervalToken);
		this.intervalToken = -1;
		if (this.runner) {
			this.runner();
		}
	}
}

export class RunOnceWorker<T> extends RunOnceScheduler {
	private units: T[] = [];

	constructor(runner: (units: T[]) => void, timeout: number) {
		super(runner, timeout);
	}

	work(unit: T): void {
		this.units.push(unit);

		if (!this.isScheduled()) {
			this.schedule();
		}
	}

	protected override doRun(): void {
		const units = this.units;
		this.units = [];

		if (this.runner) {
			this.runner(units);
		}
	}

	override dispose(): void {
		this.units = [];

		super.dispose();
	}
}

// class ThrottledWorker

// #region -- run on idle tricks ------------

// #endregion

/**
 *
 * @param task
 * @param delay
 * @param retries
 * @returns
 */
export async function retry<T>(task: ITask<Promise<T>>, delay: number, retries: number): Promise<T> {
	let lastError: Error | undefined;

	for (let i = 0; i < retries; i++) {
		try {
			return await task();
		}
		catch (error: unknown) {
			lastError = error as Error;

			await timeout(delay);
		}
	}

	throw lastError;
}

// #region Task Sequentializer

interface IPendingTask {
	taskId: number;
	cancel: () => void;
	promise: Promise<void>;
}

interface ISequentialTask {
	promise: Promise<void>;
	promiseResolve: () => void;
	promiseReject: (error: Error) => void;
	run: () => Promise<void>;
}

export interface ITaskSequentializerWithPendingTask {
	readonly pending: Promise<void>;
}

export class TaskSequentializer {
	private _pending?: IPendingTask;
	private _next?: ISequentialTask;

	hasPending(taskId?: number): this is ITaskSequentializerWithPendingTask {
		if (!this._pending) {
			return false;
		}

		if (typeof taskId === "number") {
			return this._pending.taskId === taskId;
		}

		return !!this._pending;
	}

	get pending(): Promise<void> | undefined {
		return this._pending ? this._pending.promise : undefined;
	}

	cancelPending(): void {
		this._pending?.cancel();
	}

	setPending(taskId: number, promise: Promise<void>, onCancel?: () => void,): Promise<void> {
		this._pending = { taskId, cancel: () => onCancel?.(), promise };

		promise.then(() => this.donePending(taskId), () => this.donePending(taskId));

		return promise;
	}

	private donePending(taskId: number): void {
		if (this._pending && taskId === this._pending.taskId) {
			// only set pending to done if the promise finished that is associated with that taskId
			this._pending = undefined;

			// schedule the next task now that we are free if we have any
			this.triggerNext();
		}
	}

	private triggerNext(): void {
		if (this._next) {
			const next = this._next;
			this._next = undefined;

			// Run next task and complete on the associated promise
			next.run().then(next.promiseResolve, next.promiseReject);
		}
	}

	setNext(run: () => Promise<void>): Promise<void> {
		// this is our first next task, so we create associated promise with it
		// so that we can return a promise that completes when the task has
		// completed.
		if (!this._next) {
			let promiseResolve: () => void;
			let promiseReject: (error: Error) => void;
			const promise = new Promise<void>((resolve, reject) => {
				promiseResolve = resolve;
				promiseReject = reject;
			});

			this._next = {
				run,
				promise,
				promiseResolve: promiseResolve!,
				promiseReject: promiseReject!,
			};
		}

		// we have a previous next task, just overwrite it
		else {
			this._next.run = run;
		}

		return this._next.promise;
	}
}

// #endregion

// #region

/**
 * The `IntervalCounter` allows to count the number
 * of calls to `increment()` over a duration of
 * `interval`. This utility can be used to conditionally
 * throttle a frequent task when a certain threshold
 * is reached.
 */
export class IntervalCounter {
	private lastIncrementTime = 0;

	private value = 0;

	constructor(private readonly interval: number, private readonly nowFn = () => Date.now()) { }

	increment(): number {
		const now = this.nowFn();

		// We are outside of the range of `interval` and as such
		// start counting from 0 and remember the time
		if (now - this.lastIncrementTime > this.interval) {
			this.lastIncrementTime = now;
			this.value = 0;
		}

		this.value++;

		return this.value;
	}
}

// #endregion

// #region

export type ValueCallback<T = unknown> = (value: T | Promise<T>) => void;

/**
 * Creates a promise whose resolution or rejection can be controlled imperatively.
 */
export class DeferredPromise<T> {
	private completeCallback!: ValueCallback<T>;
	private errorCallback!: (err: unknown) => void;
	private rejected = false;
	private resolved = false;

	public get isRejected() {
		return this.rejected;
	}

	public get isResolved() {
		return this.resolved;
	}

	public get isSettled() {
		return this.rejected || this.resolved;
	}

	public p: Promise<T>;

	constructor() {
		this.p = new Promise<T>((c, e) => {
			this.completeCallback = c;
			this.errorCallback = e;
		});
	}

	public complete(value: T) {
		return new Promise<void>((resolve) => {
			this.completeCallback(value);
			this.resolved = true;
			resolve();
		});
	}

	public error(err: unknown) {
		return new Promise<void>((resolve) => {
			this.errorCallback(err);
			this.rejected = true;
			resolve();
		});
	}

	public cancel() {
		new Promise<void>((resolve) => {
			this.errorCallback(canceled());
			this.rejected = true;
			resolve();
		});
	}
}

// #endregion

// #region Promises

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Promises {

	/**
	 * A drop-in replacement for `Promise.all` with the only difference
	 * that the method awaits every promise to either fulfill or reject.
	 *
	 * Similar to `Promise.all`, only the first error will be returned
	 * if any.
	 * @param promises
	 * @returns
	 */
	export async function settled<T>(promises: Promise<T>[]): Promise<T[]> {
		let firstError: Error | undefined = undefined;

		const result = await Promise.all(promises.map(promise => promise.then(value => value, (error) => {
			if (!firstError) {
				firstError = error;
			}

			return undefined; // do not rethrow so that other promises can settle
		})));

		if (typeof firstError !== "undefined") {
			throw firstError;
		}

		return result as unknown as T[]; // cast is needed and protected by the `throw` above
	}

	/**
	 * A helper to create a new `Promise<T>` with a body that is a promise
	 * itself. By default, an error that raises from the async body will
	 * end up as a unhandled rejection, so this utility properly awaits the
	 * body and rejects the promise as a normal promise does without async
	 * body.
	 *
	 * This method should only be used in rare cases where otherwise `async`
	 * cannot be used (e.g. when callbacks are involved that require this).
	 * @param bodyFn
	 * @returns
	 */
	export function withAsyncBody<T, E = Error>(bodyFn: (resolve: (value: T) => unknown, reject: (error: E) => unknown) => Promise<unknown>): Promise<T> {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise<T>(async (resolve, reject) => {
			try {
				await bodyFn(resolve, reject);
			}
			catch (error) {
				reject(error);
			}
		});
	}
}

// #endregion

// #region

const enum AsyncIterableSourceState {
	Initial,
	DoneOK,
	DoneError,
}

/**
 * An object that allows to emit async values asynchronously or bring the iterable to an error state using `reject()`.
 * This emitter is valid only for the duration of the executor (until the promise returned by the executor settles).
 */
export interface AsyncIterableEmitter<T> {
	/**
	 * The value will be appended at the end.
	 *
	 * **NOTE** If `reject()` has already been called, this method has no effect.
	 */
	emitOne(value: T): void;
	/**
	 * The values will be appended at the end.
	 *
	 * **NOTE** If `reject()` has already been called, this method has no effect.
	 */
	emitMany(values: T[]): void;
	/**
	 * Writing an error will permanently invalidate this iterable.
	 * The current users will receive an error thrown, as will all future users.
	 *
	 * **NOTE** If `reject()` have already been called, this method has no effect.
	 */
	reject(error: Error): void;
}

/**
 * An executor for the `AsyncIterableObject` that has access to an emitter.
 */
export interface AyncIterableExecutor<T> {
	/**
	 * @param emitter An object that allows to emit async values valid only for the duration of the executor.
	 */
	(emitter: AsyncIterableEmitter<T>): void | Promise<void>;
}

/**
 * A rich implementation for an `AsyncIterable<T>`.
 */
export class AsyncIterableObject<T> implements AsyncIterable<T> {
	public static fromArray<T>(items: T[]): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>((writer) => {
			writer.emitMany(items);
		});
	}

	public static fromPromise<T>(promise: Promise<T[]>): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>(async (emitter) => {
			emitter.emitMany(await promise);
		});
	}

	public static fromPromises<T>(promises: Promise<T>[]): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>(async (emitter) => {
			await Promise.all(promises.map(async p => emitter.emitOne(await p)));
		});
	}

	public static merge<T>(iterables: AsyncIterable<T>[]): AsyncIterableObject<T> {
		return new AsyncIterableObject(async (emitter) => {
			await Promise.all(iterables.map(async (iterable) => {
				for await (const item of iterable) {
					emitter.emitOne(item);
				}
			}));
		});
	}

	public static EMPTY = AsyncIterableObject.fromArray<any>([]);

	private _state: AsyncIterableSourceState;
	private _results: T[];
	private _error: Error | null;
	private readonly _onStateChanged: EventEmitter<void>;

	constructor(executor: AyncIterableExecutor<T>) {
		this._state = AsyncIterableSourceState.Initial;
		this._results = [];
		this._error = null;
		this._onStateChanged = new EventEmitter<void>();

		queueMicrotask(async () => {
			const writer: AsyncIterableEmitter<T> = {
				emitOne: item => this.emitOne(item),
				emitMany: items => this.emitMany(items),
				reject: error => this.reject(error),
			};
			try {
				await Promise.resolve(executor(writer));
				this.resolve();
			}
			catch (err: unknown) {
				this.reject(err as Error);
			}
			finally {
				writer.emitOne = undefined!;
				writer.emitMany = undefined!;
				writer.reject = undefined!;
			}
		});
	}

	[Symbol.asyncIterator](): AsyncIterator<T, undefined, undefined> {
		let i = 0;
		return {
			next: async () => {
				do {
					if (this._state === AsyncIterableSourceState.DoneError) {
						throw this._error;
					}
					if (i < this._results.length) {
						return { done: false, value: this._results[i++] };
					}
					if (this._state === AsyncIterableSourceState.DoneOK) {
						return { done: true, value: undefined };
					}
					await Event.toPromise(this._onStateChanged.event);
					// eslint-disable-next-line no-constant-condition
				} while (true);
			},
		};
	}

	public static map<T, R>(iterable: AsyncIterable<T>, mapFn: (item: T) => R): AsyncIterableObject<R> {
		return new AsyncIterableObject<R>(async (emitter) => {
			for await (const item of iterable) {
				emitter.emitOne(mapFn(item));
			}
		});
	}

	public map<R>(mapFn: (item: T) => R): AsyncIterableObject<R> {
		return AsyncIterableObject.map(this, mapFn);
	}

	public static filter<T>(iterable: AsyncIterable<T>, filterFn: (item: T) => boolean): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>(async (emitter) => {
			for await (const item of iterable) {
				if (filterFn(item)) {
					emitter.emitOne(item);
				}
			}
		});
	}

	public filter(filterFn: (item: T) => boolean): AsyncIterableObject<T> {
		return AsyncIterableObject.filter(this, filterFn);
	}

	public static coalesce<T>(iterable: AsyncIterable<T | undefined | null>): AsyncIterableObject<T> {
		return <AsyncIterableObject<T>>AsyncIterableObject.filter(iterable, item => !!item);
	}

	public coalesce(): AsyncIterableObject<NonNullable<T>> {
		return AsyncIterableObject.coalesce(this) as AsyncIterableObject<NonNullable<T>>;
	}

	public static async toPromise<T>(iterable: AsyncIterable<T>): Promise<T[]> {
		const result: T[] = [];
		for await (const item of iterable) {
			result.push(item);
		}
		return result;
	}

	public toPromise(): Promise<T[]> {
		return AsyncIterableObject.toPromise(this);
	}

	/**
	 * The value will be appended at the end.
	 *
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 * @param value
	 */
	private emitOne(value: T): void {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		// it is important to add new values at the end,
		// as we may have iterators already running on the array
		this._results.push(value);
		this._onStateChanged.fire();
	}

	/**
	 * The values will be appended at the end.
	 *
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 * @param values
	 */
	private emitMany(values: T[]): void {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		// it is important to add new values at the end,
		// as we may have iterators already running on the array
		this._results = this._results.concat(values);
		this._onStateChanged.fire();
	}

	/**
	 * Calling `resolve()` will mark the result array as complete.
	 *
	 * **NOTE** `resolve()` must be called, otherwise all consumers of this iterable will hang indefinitely, similar to a non-resolved promise.
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 */
	private resolve(): void {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		this._state = AsyncIterableSourceState.DoneOK;
		this._onStateChanged.fire();
	}

	/**
	 * Writing an error will permanently invalidate this iterable.
	 * The current users will receive an error thrown, as will all future users.
	 *
	 * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
	 * @param error
	 */
	private reject(error: Error) {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		this._state = AsyncIterableSourceState.DoneError;
		this._error = error;
		this._onStateChanged.fire();
	}
}

export class CancelableAsyncIterableObject<T> extends AsyncIterableObject<T> {
	constructor(
		private readonly _source: CancellationTokenSource,
		executor: AyncIterableExecutor<T>
	) {
		super(executor);
	}

	cancel(): void {
		this._source.cancel();
	}
}

/**
 *
 * @param callback
 * @returns
 */
export function createCancelableAsyncIterable<T>(callback: (token: CancellationToken) => AsyncIterable<T>): CancelableAsyncIterableObject<T> {
	const source = new CancellationTokenSource();
	const innerIterable = callback(source.token);

	return new CancelableAsyncIterableObject<T>(source, async (emitter) => {
		const subscription = source.token.onCancellationRequested(() => {
			subscription.dispose();
			source.dispose();
			emitter.reject(canceled());
		});
		try {
			for await (const item of innerIterable) {
				if (source.token.isCancellationRequested) {
					// canceled in the meantime
					return;
				}
				emitter.emitOne(item);
			}
			subscription.dispose();
			source.dispose();
		}
		catch (err: unknown) {
			subscription.dispose();
			source.dispose();
			emitter.reject(err as Error);
		}
	});
}

// #endregion
