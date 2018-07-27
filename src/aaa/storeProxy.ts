import { History } from "history";
import { Action, applyMiddleware, createStore, compose, Middleware, combineReducers, ReducersMapObject } from "redux";
import { put, takeEvery } from "redux-saga/effects";
import createSagaMiddleware, { SagaMiddleware } from "redux-saga";
import { connectRouter, routerMiddleware } from "connected-react-router";
import { INIT_MODULE_ACTION_NAME, NSP, errorAction, initLocationAction } from "./actions";
import { ActionHandlerMap, SingleStore, StoreState, BaseModuleState } from "./types";

let singleStore: SingleStore;
let rootState: StoreState<{}> = null;
const sagasMap: ActionHandlerMap<any> = {};
const reducersMap: ActionHandlerMap<any> = {};
const sagaNames: string[] = [];

function setRootState(state: StoreState<{}>) {
  rootState = state;
}
export function getRootState(): StoreState<{}> {
  return rootState;
}
export function getModuleState(namespace: string): BaseModuleState {
  return rootState.project[namespace];
}
export function getSingleStore(): SingleStore {
  return singleStore;
}
function getActionData(action: {}) {
  const arr = Object.keys(action).filter(key => key !== "type");
  if (arr.length === 0) {
    return undefined;
  } else if (arr.length === 1) {
    return action[arr[0]];
  } else {
    const data = { ...action };
    delete data["type"];
    return data;
  }
}

function reducer(state: any = {}, action: { type: string; data?: any }) {
  const item = reducersMap[action.type];
  if (item && singleStore) {
    const newState = { ...state };
    const list: string[] = [];
    Object.keys(item).forEach(namespace => {
      const fun = item[namespace];
      if (fun["__handler__"]) {
        list.push(namespace);
      } else {
        list.unshift(namespace);
      }
    });
    list.forEach(namespace => {
      const fun = item[namespace];
      const decorators: Array<[(actionName: string, moduleName: string) => any, (data: any, state: any) => void, any]> | null = fun["__decorators__"];
      if (decorators) {
        decorators.forEach(decorator => {
          decorator[2] = decorator[0](action.type, namespace);
        });
      }
      const ins = fun["__host__"];
      const result = fun.call(ins, getActionData(action));
      newState[namespace] = result;
      setRootState({ ...rootState, project: { ...rootState.project, [namespace]: result } });
      if (action.type === namespace + NSP + INIT_MODULE_ACTION_NAME) {
        // 对模块补发一次locationChange
        setTimeout(() => {
          if (singleStore) {
            singleStore.dispatch(initLocationAction(namespace, rootState.router));
          }
        }, 0);
      }
      if (decorators) {
        decorators.forEach(decorator => {
          decorator[1](decorator[2], newState[namespace]);
          decorator[2] = null;
        });
      }
    });
    return newState;
  }
  return state;
}

function* sagaHandler(action: { type: string; data: any }) {
  const item = sagasMap[action.type];
  if (item && singleStore) {
    const list: string[] = [];
    Object.keys(item).forEach(namespace => {
      const fun = item[namespace];
      if (fun["__handler__"]) {
        list.push(namespace);
      } else {
        list.unshift(namespace);
      }
    });
    for (const moduleName of list) {
      const fun = item[moduleName];
      const decorators: Array<[(actionName: string, moduleName: string) => any, (data: any, error?: Error) => void, any]> | null = fun["__decorators__"];
      let err: Error | undefined;
      if (decorators) {
        decorators.forEach(decorator => {
          decorator[2] = decorator[0](action.type, moduleName);
        });
      }
      try {
        const ins = fun["__host__"];
        yield* fun.call(ins, getActionData(action));
      } catch (error) {
        err = error;
      }
      if (err) {
        yield put(errorAction(err));
      }
      if (decorators) {
        decorators.forEach(decorator => {
          decorator[1](decorator[2], err);
          decorator[2] = null;
        });
      }
    }
  }
}

// function* saga() {
//   yield takeEvery(sagaNames, sagaHandler);
// }
function* saga() {
  yield takeEvery("*", sagaHandler); // 性能更高？
}
function rootReducer(combineReducer: Function) {
  return (state: any | undefined, action: Action) => {
    rootState = state || {};
    rootState = combineReducer(state, action);
    return rootState;
  };
}
export function getSagaNames() {
  return [...sagaNames];
}
export function buildStore(storeHistory: History, reducers: ReducersMapObject, storeMiddlewares: Middleware[], storeEnhancers: Function[], injectedModules: Array<{ type: string }>) {
  let devtools = (options: any) => (noop: any) => noop;
  if (process.env.NODE_ENV !== "production" && window["__REDUX_DEVTOOLS_EXTENSION__"]) {
    devtools = window["__REDUX_DEVTOOLS_EXTENSION__"];
  }
  if (reducers.router || reducers.project) {
    throw new Error("the reducer name 'router' 'project' is not allowed");
  }
  reducers.project = reducer;
  const routingMiddleware = routerMiddleware(storeHistory);
  const sagaMiddleware: SagaMiddleware<any> = createSagaMiddleware();
  const middlewares = [...storeMiddlewares, routingMiddleware, sagaMiddleware];
  const enhancers = [...storeEnhancers, applyMiddleware(...middlewares), devtools(window["__REDUX_DEVTOOLS_EXTENSION__OPTIONS"])];
  const store: SingleStore = createStore(rootReducer(connectRouter(storeHistory)(combineReducers(reducers))), {}, compose(...enhancers));
  singleStore = store;
  sagaMiddleware.run(saga as any);
  window.onerror = (message: string, filename?: string, lineno?: number, colno?: number, error?: Error) => {
    store.dispatch(errorAction(error || { message }));
  };

  injectedModules.forEach(action => {
    store.dispatch(action);
  });
  injectedModules.length = 0;
  return store;
}

export { sagasMap, reducersMap, sagaNames };