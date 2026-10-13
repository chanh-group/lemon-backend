import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class ExampleService {
  private readonly logger = new Logger(ExampleService.name);

  getHello(): string {
    this.logger.log("Example hello greeting requested", { action: "example.get_hello" });
    return "Hello World!";
  }
}
