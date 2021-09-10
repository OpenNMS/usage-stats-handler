import axios, {AxiosResponse} from "axios";

export class Httpclient {
    private axiosInstance = axios.create({
        baseURL: "http://localhost:9200",
        headers: {
            "Content-type": "application/json"
        }
    });

    public post(path: string, data: any): Promise<AxiosResponse> {
        return this.axiosInstance.post(path, data);
    }

    public put (path: string, data: any): Promise<AxiosResponse> {
        return this.axiosInstance.put(path, data);
    }

    public get(path: string): Promise<AxiosResponse> {
        return this.axiosInstance.get(path);
    }
}