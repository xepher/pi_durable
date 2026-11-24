const dictTools = {
    'get_temperature': getTemperature
};

function getTemperature(city) {
    switch (city) {
        case '北京':
            return 6;
        case '杭州':
            return 14;
        default:
            return null;
    }
}

export function dispatchTool(name, argumentsJson) {
    // result
    let result = {
        ok: false
    };

    // verify tool name
    if (typeof name !== 'string' || !Object.hasOwn(dictTools, name)) {
        result.error = `unknown_tool`;
        return result;
    };
    
    const tool = dictTools[name];

    if(typeof argumentsJson !== 'string') {
        result.error = `invalid_arguments`;
        return result;
    }

    // verify arguments
    let data;
    try {
        data = JSON.parse(argumentsJson);
    } catch (e) {
        result.error = `invalid_json`;
        return result;
    }

    const isPlainObject = data && typeof data === 'object' && !Array.isArray(data) && Object.getPrototypeOf(data) === Object.prototype;
    if (!isPlainObject) {
        result.error = `invalid_arguments`;
        return result;
    }

    const keys = Object.keys(data);
    if (keys.length !== 1 || keys[0] !== 'city') {
        result.error = `invalid_arguments`;
        return result;
    }

    if (typeof data.city !== 'string' || data.city.trim() === '') {
        result.error = `invalid_arguments`;
        return result;
    }

    if (tool(data.city) === null) {
        result.error = `unknown_city`;
        return result;
    }

    result.ok = true;
    result.city = data.city;
    result.celsius = tool(data.city);

    return result;
}