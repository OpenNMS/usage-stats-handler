import axios, {AxiosInstance, AxiosResponse} from "axios";
import axiosRetry from 'axios-retry';

export class Httpclient {
    private axiosInstance: AxiosInstance;

    constructor(baseUrl: string) {
        this.axiosInstance = axios.create({
            baseURL: baseUrl,
            headers: {
                "Content-type": "application/json"
            }
        });
        axiosRetry(this.axiosInstance, {
            retries: 100,
            retryDelay: () => 5000,
            retryCondition: () => true,
        });
    }

    public post(path: string, data: any): Promise<AxiosResponse> {
        return this.axiosInstance.post(path, data);
    }

    public put(path: string, data: any): Promise<AxiosResponse> {
        return this.axiosInstance.put(path, data);
    }

    public get(path: string): Promise<AxiosResponse> {
        return this.axiosInstance.get(path);
    }
}